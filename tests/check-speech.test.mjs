// web/api/check-speech.js 시험 · 전역 fetch를 가짜로 바꿔 실제 오픈하사를 부르지 않고 확인합니다.
// 실행: 저장소 최상위에서  node --test tests/check-speech.test.mjs
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import handler, { STT_URL, MODEL, MAX_BYTES, normalize, grade } from '../web/api/check-speech.js';

const KEY = 'sk-dev-test-0000';
const data = JSON.parse(readFileSync(new URL('../web/data/sentences.json', import.meta.url), 'utf8'));
const s001 = data.sentences.find((s) => s.id === '001');
const TARGET = s001.egypt[s001.blankSide]; // من زمان ما شفتكش! عامل إيه اليومين دول؟

function call({ id = '001', dialect = 'egypt', audio = new Blob([new Uint8Array(2000)], { type: 'audio/webm' }), method = 'POST' } = {}) {
  if (method !== 'POST') return handler.fetch(new Request('http://localhost/api/check-speech', { method }));
  const form = new FormData();
  if (audio) form.append('audio', audio, 'speech');
  if (id !== null) form.append('id', id);
  if (dialect !== null) form.append('dialect', dialect);
  return handler.fetch(new Request('http://localhost/api/check-speech', { method: 'POST', body: form }));
}
const fakeStt = (make) => mock.method(globalThis, 'fetch', async (input, init) => make(input, init));
const sttText = (text) => fakeStt(() => Response.json({ text }));

let errorLog;
beforeEach(() => {
  process.env.HASA_API_KEY = KEY;
  errorLog = mock.method(console, 'error', () => {});
});
afterEach(() => {
  mock.restoreAll();
  delete process.env.HASA_API_KEY;
});

test('정상: 원어민처럼 말하면 100점, 받아쓰기 요청 형식이 맞다', async () => {
  const stt = sttText('من زمان ما شفتكش عامل ايه اليومين دول؟'); // 실제 Whisper 결과(2026-11-18): 느낌표 없음, إ → ا
  const res = await call();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.score, 100);
  assert.equal(body.target, TARGET);
  assert.equal(body.side, s001.blankSide);
  assert.ok(body.words.every((w) => w.ok === true));
  assert.equal(body.model, MODEL);

  const [input, init] = stt.mock.calls[0].arguments;
  assert.equal(String(input), STT_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.body.get('model'), 'whisper-large-v3-turbo');
  assert.equal(init.body.get('language'), 'ar');
  assert.equal(init.body.get('file').name, 'speech.webm');
  assert.ok(!JSON.stringify(body).includes(KEY), '응답에 키가 없다');
});

test('일부만 말하면 맞은 단어와 놓친 단어를 나눠 준다', async () => {
  sttText('من زمان ما شفتكش');
  const body = await (await call()).json();
  assert.equal(body.score, 50);
  assert.deepEqual(body.words.map((w) => w.ok), [true, true, true, true, false, false, false, false]);
});

test('방언을 바꿔 말하면(요르단식 شفتك) 그 단어는 틀린 것으로 본다', async () => {
  sttText('من زمان ما شفتك عامل ايه اليومين دول');
  const body = await (await call()).json();
  assert.equal(body.words.find((w) => w.word.startsWith('شفتكش')).ok, false);
  assert.equal(body.score, 88);
});

test('전혀 다른 말(푸스하 문장)이면 0점', async () => {
  sttText('كيف حالك هذه الأيام');
  assert.equal((await (await call()).json()).score, 0);
});

test('사우디(gulf) 문장도 채점한다', async () => {
  sttText(s001.gulf[s001.blankSide]);
  const body = await (await call({ dialect: 'gulf' })).json();
  assert.equal(body.score, 100);
});

test('잘못된 입력은 400이고, AI를 부르지 않는다', async () => {
  const stt = sttText('x');
  for (const [args, code] of [
    [{ id: '999' }, 'BAD_ID'],
    [{ id: 'abc' }, 'BAD_ID'],
    [{ id: null }, 'BAD_ID'],
    [{ dialect: 'morocco' }, 'BAD_DIALECT'],
    [{ dialect: 'fusha' }, 'BAD_DIALECT'],
    [{ audio: null }, 'NO_AUDIO'],
    [{ audio: new Blob([], { type: 'audio/webm' }) }, 'NO_AUDIO'],
    [{ audio: new Blob(['hello'], { type: 'text/plain' }) }, 'BAD_AUDIO'],
  ]) {
    const res = await call(args);
    assert.equal(res.status, 400, JSON.stringify(args));
    assert.equal((await res.json()).code, code, JSON.stringify(args));
  }
  assert.equal(stt.mock.callCount(), 0);
});

test('녹음이 1MB를 넘으면 413', async () => {
  const stt = sttText('x');
  const res = await call({ audio: new Blob([new Uint8Array(MAX_BYTES + 10)], { type: 'audio/webm' }) });
  assert.equal(res.status, 413);
  assert.equal(stt.mock.callCount(), 0);
});

test('키가 없으면 500과 설정 안내, AI를 부르지 않는다', async () => {
  const stt = sttText('x');
  delete process.env.HASA_API_KEY;
  const res = await call();
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.code, 'NO_KEY');
  assert.match(body.hint, /HASA_API_KEY/);
  assert.equal(stt.mock.callCount(), 0);
});

test('한도 초과(429)는 429와 하루 한도 안내', async () => {
  fakeStt(() => new Response('{}', { status: 429, headers: { 'Retry-After': '20' } }));
  const res = await call();
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '20');
  assert.match((await res.json()).hint, /하루 500건/);
});

test('시간 초과는 504', async () => {
  fakeStt(() => { throw new DOMException('timeout', 'TimeoutError'); });
  const res = await call();
  assert.equal(res.status, 504);
  assert.equal((await res.json()).code, 'AI_TIMEOUT');
});

test('받아쓴 글이 비어 있으면(소리 없음) 422 NO_SPEECH', async () => {
  for (const text of ['', '  ', '...']) {
    mock.restoreAll();
    mock.method(console, 'error', () => {});
    sttText(text);
    const res = await call();
    assert.equal(res.status, 422, JSON.stringify(text));
    assert.equal((await res.json()).code, 'NO_SPEECH');
  }
});

test('키 거절(401)은 500, 로그에 키와 받아쓴 글을 남기지 않는다', async () => {
  fakeStt(() => new Response(`{"error":"bad key ${KEY}","text":"من زمان"}`, { status: 401 }));
  const res = await call();
  assert.equal(res.status, 500);
  assert.equal((await res.json()).code, 'AI_KEY');
  const logged = errorLog.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /HTTP 401/);
  assert.ok(!logged.includes(KEY));
  assert.ok(!logged.includes('من زمان'));
});

test('POST가 아닌 요청은 405', async () => {
  assert.equal((await call({ method: 'GET' })).status, 405);
});

test('normalize: 모음 부호·알리프 변형·ة·ى·문장부호를 정리한다', () => {
  assert.equal(normalize('لم أرَكَ منذ زمنٍ طويل!'), 'لم ارك منذ زمن طويل');
  assert.equal(normalize('إيه؟ آه، مدرسة على'), 'ايه اه مدرسه علي');
  assert.equal(normalize('شُكْرًا جـــزيلًا'), 'شكرا جزيلا');
});

test('grade: 순서를 지켜 짝을 맞추고, 문장부호만 있는 낱말은 채점하지 않는다', () => {
  const g = grade('أنا – بخير، والحمد لله', 'انا بخير والحمد لله');
  assert.equal(g.score, 100);
  assert.equal(g.words[1].ok, null);
  assert.equal(grade('عامل إيه', 'ايه عامل').score, 50, '순서가 바뀌면 하나만 맞음');
});
