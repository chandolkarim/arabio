const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let writes = 0;
const audio = [];
const node = { dataset:{}, style:{setProperty(){}}, classList:{remove(){}}, querySelectorAll(){return []}, querySelector(){return null}, getAnimations(){return []}, addEventListener(){}, setAttribute(){}, removeAttribute(){} };
let notice = null;
const context = vm.createContext({
  console, document:{getElementById(id){return id==='service-status'?notice:node},querySelector(){return null},querySelectorAll(){return []},addEventListener(){},createElement(){return {dataset:{},setAttribute(){}}},body:{appendChild(n){notice=n}},documentElement:{dataset:{}}},
  window:{matchMedia(){return {matches:true}},scrollTo(){}},
  localStorage:{getItem(){return null},setItem(){writes++}},setTimeout(){},requestAnimationFrame(fn){fn()},
  Audio:class{constructor(src){this.src=src;this.handlers={};this.paused=true;audio.push(this)}addEventListener(k,fn){this.handlers[k]=fn}pause(){this.paused=true}play(){this.paused=false;return Promise.resolve()}},
});
vm.runInContext(fs.readFileSync('web/app.js','utf8').split('(async function boot()')[0],context);
const run = s=>vm.runInContext(s,context);
context.fixture = JSON.parse(fs.readFileSync('web/data/sentences.json','utf8'));
run('DATA=fixture;state={dialect:"egypt",progress:{},audioRate:0.8};');
assert.equal(run('normalizeState({dialect:"__proto__"}).dialect'),null);
context.saved = {dialect:'egypt',progress:{egypt:{completedDays:[1,1,3,0,101],srs:{'001':{due:'2026-10-11',box:2,hard:1,last:'외웠어요'}},history:{'2026-10-10':3},xp:210}}};
const restored=run('normalizeState(saved)');
assert.equal(JSON.stringify(restored.progress.egypt.completedDays),'[1,3]');
assert.equal(restored.progress.egypt.srs['001'].box,2);
assert.equal(restored.progress.egypt.xp,210);
run('state=normalizeState(saved)');
assert.equal(run('nextDay()'),2,'unfinished earlier days must not be skipped');
run('state.audioRate=0.8;speak(DATA.sentences[0],"fusha","A")');
assert.equal(audio[0].playbackRate,0.8);
run('show("next page",{tabs:false})');
assert.equal(audio[0].paused,true,'navigation must stop playing audio');
run('speak(DATA.sentences[0],"fusha","B")');
audio[1].handlers.error();
assert.equal(notice.hidden,false,'playback failure must be visible');
assert.match(notice.textContent,/재생하지 못했어요/);
run('state={dialect:"egypt",progress:{}};lesson={day:1,list:sentencesOfDay(1),mode:"lesson",ratings:{"001":true,"002":true,"003":true}};');
writes=0;
run('finishLesson();finishLesson()');
assert.equal(writes,1,'a completed lesson must commit progress only once');
assert.equal(run('progress().xp'),30);
assert.equal(run('Object.keys(progress().srs).length'),3);
console.log('PASS: progress repair, unfinished day, playback speed, stop on navigation, visible audio errors, single completion commit');
