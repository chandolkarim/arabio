const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const played = [];
let fallback = 0;
const node = { addEventListener() {} };
const synthesis = { cancel() {}, speak() { fallback++; } };
const context = vm.createContext({
  console, document: { getElementById: () => node, addEventListener() {} },
  window: { speechSynthesis: synthesis }, speechSynthesis: synthesis,
  localStorage: { getItem() { return null; } },
  Audio: class { constructor(src) { this.src = src; } pause() {} addEventListener() {} play() { played.push(this.src); return Promise.resolve(); } },
});
vm.runInContext(fs.readFileSync('web/app.js', 'utf8').split('(async function boot()')[0], context);
const data = JSON.parse(fs.readFileSync('web/data/sentences.json', 'utf8'));
context.example = data.sentences[5];
for (const variant of ['fusha', 'egypt', 'jordan']) {
  vm.runInContext(`speak(example, '${variant}', 'B')`, context);
  assert.equal(played.at(-1), `audio/${context.example[variant].audio.B}?v=${context.example[variant].audioRevision.B}`);
}
assert.equal(new Set(played).size, 3, 'variants must use distinct files');
context.missing = { fusha: { A: 'نص', audio: {} } };
vm.runInContext("speak(missing, 'fusha', 'A')", context);
assert.equal(played.length, 3, 'missing audio must not play another file');
assert.equal(fallback, 0, 'missing audio must not use browser synthesis');
const button = { dataset: { variant: 'fusha', side: 'A' }, addEventListener() { throw Error('missing file bound'); } };
context.root = { querySelectorAll() { return [button]; } };
vm.runInContext('bindPlay(missing, root)', context);
assert.equal(button.disabled, true);
assert.equal(button.textContent, '음성 준비 중');
console.log('PASS: separate voice files, no browser fallback, unavailable buttons disabled');
