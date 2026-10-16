const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// 1) 버전 세 곳(index.html ?v=, version.txt, sw.js VERSION)과 소개 페이지가 같아야 새 배포가 캐시에 갇히지 않는다.
const version = fs.readFileSync('web/version.txt', 'utf8').trim();
const sw = fs.readFileSync('web/sw.js', 'utf8');
assert.equal(/const VERSION = "([^"]+)"/.exec(sw)[1], version, 'sw.js VERSION must match version.txt');
for (const page of ['web/index.html', 'web/privacy.html']) {
  const vs = [...fs.readFileSync(page, 'utf8').matchAll(/\?v=([\w-]+)/g)].map(m => m[1]);
  assert.ok(vs.length > 0 && vs.every(v => v === version), `${page} ?v= must all be ${version}`);
}

// 2) 미리 저장하는 파일이 실제로 있어야 서비스 워커 설치가 실패하지 않는다.
const ctx = { self: { addEventListener() {} }, location: { origin: 'x' } };
vm.runInNewContext(sw + ';this.SHELL_FILES=SHELL_FILES', ctx);
for (const file of ctx.SHELL_FILES) {
  const path = file === './' ? 'index.html' : file.split('?')[0];
  assert.ok(fs.existsSync(`web/${path}`), `precached file missing: ${path}`);
}

// 3) 매니페스트 아이콘 크기가 적힌 그대로인지 (PNG 머리글의 가로·세로)
const manifest = JSON.parse(fs.readFileSync('web/manifest.webmanifest', 'utf8'));
assert.ok(manifest.icons.some(i => i.purpose === 'maskable'), 'a maskable icon is required for Android');
for (const icon of manifest.icons) {
  const png = fs.readFileSync(`web/${icon.src}`);
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes, icon.src);
}

// 4) 백업 코드·파일을 되돌리면 같은 진도가 나온다.
const node = { addEventListener(){}, querySelectorAll(){return []}, style:{setProperty(){}}, classList:{remove(){}}, innerHTML:'' };
const app = vm.createContext({ console, TextEncoder, TextDecoder, btoa, atob, Uint8Array, document:{getElementById:()=>node,addEventListener(){},querySelector(){return null}}, window:{}, localStorage:{getItem(){return null},setItem(){}}, setTimeout(){}, requestAnimationFrame:fn=>fn() });
vm.runInContext(fs.readFileSync('web/app.js','utf8').split('(async function boot()')[0], app);
const run = code => vm.runInContext(code, app);
run(`state = normalizeState({dialect:"jordan", introSeen:true, dailyGoal:60, sfx:false, hearts:{count:3, refillAt:${Date.now() + 1000}},
  progress:{jordan:{completedDays:[1,2,3], xp:120, history:{"2026-10-15":3,"2026-10-16":6}, srs:{"001":{box:2,due:"2026-10-20",hard:1,last:"외웠어요"}}}}});`);
const before = run('JSON.stringify(state)');
const code = run('backupCode()');
assert.match(code, /^ARABIO1\.[\w-]+$/, 'backup code is URL-safe text');
assert.equal(run(`JSON.stringify(readBackup(${JSON.stringify(code)}).state)`), before, 'code round trip keeps progress');
assert.equal(run(`JSON.stringify(readBackup(${JSON.stringify('  ' + code.slice(0, 40) + '\n' + code.slice(40) + ' ')}).state)`), before, 'spaces and line breaks from chat apps are ignored');
assert.equal(run('JSON.stringify(readBackup(backupJson()).state)'), before, 'file (JSON) round trip keeps progress');
assert.throws(() => run('readBackup("hello")'), /백업 코드가 아니에요/);
assert.throws(() => run('readBackup(\'{"app":"other","state":{}}\')'), /백업 코드가 아니에요/);
assert.equal(run('readBackup(\'{"app":"arabio","state":{"progress":{"egypt":{"completedDays":[1,999]}}}}\').state.progress.egypt.completedDays.join()'), '1', 'restored data is cleaned like saved data');
console.log('PASS: matching versions, precache files exist, icon sizes, backup code/file round trip, bad backups rejected');
