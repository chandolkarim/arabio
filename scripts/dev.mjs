// 로컬 시험 서버 · web/ 화면과 web/api/ 함수(말하기 AI 채점)를 한 주소에서 함께 엽니다.
//
//   node scripts/dev.mjs           실제 호출. 저장소 최상위 .env.local의 HASA_API_KEY를 읽습니다(없으면 함수가 500을 돌려줍니다)
//   node scripts/dev.mjs --mock    연습 모드. 오픈하사 대신 정답 문장을 그대로 받아쓴 것처럼 답합니다(키 불필요)
//   PORT=4000 node scripts/dev.mjs 다른 포트로 열기 (기본 3000)
//
// Vercel과 완전히 같지는 않습니다(CDN 캐시·리전·로그 없음). 배포 전에 화면과 함수가 함께 동작하는지 보는 용도입니다.
// .env.local은 web/ 밖(저장소 최상위)에 있어 이 서버가 화면 파일로 내보내지 않습니다.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB = join(ROOT, 'web');
const PORT = Number(process.env.PORT || 3000);
const MOCK = process.argv.includes('--mock');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
};

loadEnvFile(join(ROOT, '.env.local'));
if (MOCK) installMock();

createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/api/')) await runFunction(req, res, url);
    else await serveFile(req, res, url);
  } catch (error) {
    console.error('[dev] 서버 오류:', error);
    if (!res.headersSent) send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, '시험 서버 오류: 터미널을 확인하세요.');
  }
  if (url.pathname.startsWith('/api/') || !url.pathname.includes('/audio/')) {
    console.log(`${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - started}ms)`);
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`\n아라비오 로컬 시험 서버 · http://localhost:${PORT}`);
  console.log(`- AI 키 HASA_API_KEY: ${process.env.HASA_API_KEY ? '있음(값은 표시하지 않음)' : '없음'}`);
  console.log(`- 연습 모드: ${MOCK ? '켜짐 · 오픈하사 대신 정답 문장을 그대로 받아쓴 것처럼 답합니다' : '꺼짐 · 실제 오픈하사 Whisper를 부릅니다'}`);
  console.log('- 끝낼 때는 Ctrl+C\n');
});

// /api/이름 → web/api/이름.js 의 export default { fetch(request) }
async function runFunction(req, res, url) {
  const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  const file = join(WEB, 'api', `${name}.js`);
  if (!/^[\w-]+$/.test(name) || !existsSync(file)) {
    return send(res, 404, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ error: `함수 파일이 없습니다: api/${name}.js` }));
  }
  const mod = await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const request = new Request(url, { method: req.method, headers, body });
  if (MOCK && req.method === 'POST') await rememberMockTarget(request.clone());
  const response = await mod.default.fetch(request);
  const out = {};
  response.headers.forEach((v, k) => { out[k] = v; });
  send(res, response.status, out, Buffer.from(await response.arrayBuffer()));
}

// web/ 안의 정적 파일만 보냅니다. 숨김 파일과 web/ 밖 경로는 열지 않습니다
async function serveFile(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(WEB, `.${path}`);
  const hidden = path.split('/').some((part) => part.startsWith('.'));
  if (hidden || !file.startsWith(WEB + sep) || !(await isFile(file))) {
    return send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, '404 · 파일이 없습니다.');
  }
  send(res, 200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' },
    req.method === 'HEAD' ? '' : await readFile(file));
}

function send(res, status, headers, body) { res.writeHead(status, headers); res.end(body); }
async function isFile(p) { try { return (await stat(p)).isFile(); } catch { return false; } }
function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

// .env.local의 KEY=VALUE 줄을 읽어 환경 변수로 넣습니다(이미 있는 값은 그대로 둡니다)
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (value && process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

// 연습 모드: open.hasa.re.kr 받아쓰기 요청만 가로채, 정답 문장의 앞 70%만 말한 것처럼 답합니다(맞은 단어·놓친 단어 화면 확인용)
let mockTarget = '';
let SENTENCES = null;
async function rememberMockTarget(request) {
  try {
    const form = await request.formData();
    const s = SENTENCES.get(String(form.get('id')));
    const d = String(form.get('dialect'));
    mockTarget = s?.[d]?.[s.blankSide === 'B' ? 'B' : 'A'] ?? '';
  } catch { mockTarget = ''; }
}
function installMock() {
  const realFetch = globalThis.fetch;
  const data = JSON.parse(readFileSync(join(WEB, 'data', 'sentences.json'), 'utf8'));
  SENTENCES = new Map(data.sentences.map((s) => [s.id, s]));
  process.env.HASA_API_KEY ||= 'practice-mode-key';
  globalThis.fetch = async (input, init = {}) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    if (target.hostname !== 'open.hasa.re.kr') return realFetch(input, init);
    await new Promise((ok) => setTimeout(ok, 900));
    const words = mockTarget.split(/\s+/).filter(Boolean);
    return Response.json({ text: words.slice(0, Math.ceil(words.length * 0.7)).join(' ') });
  };
}
