const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let onClick = null;
const node = { addEventListener(type, fn){ onClick = fn; }, querySelectorAll(){return []}, style:{setProperty(){}}, classList:{remove(){}}, innerHTML:'' };
const context = vm.createContext({ console, document:{getElementById:()=>node,addEventListener(){},querySelector(){return null}}, window:{matchMedia(){return {matches:true}}}, localStorage:{getItem(){return null},setItem(){}}, setTimeout(){}, clearTimeout(){}, requestAnimationFrame:fn=>fn() });
vm.runInContext(fs.readFileSync('web/app.js','utf8').split('(async function boot()')[0],context);
context.fixture = JSON.parse(fs.readFileSync('web/data/sentences.json','utf8'));
const run = code => vm.runInContext(code,context);
run('DATA=fixture; renderStep=()=>{}; burst=()=>{}; let html=""; show=h=>{html=h}; let shown=[]; screenStreak=next=>{shown.push("streak");next()}; screenGoal=next=>{shown.push("goal");next()}; screenHome=()=>shown.push("home");');

// 하루 목표 값 보정과 오늘 경험치 계산
assert.equal(run('normalizeState({dailyGoal:60}).dailyGoal'),60);
assert.equal(run('normalizeState({dailyGoal:45}).dailyGoal'),30,'unknown goals fall back to 30 XP');
run('state={dialect:"egypt",progress:{egypt:{completedDays:[],srs:{},history:{[today()]:2,[today(-1)]:5},xp:70},jordan:{completedDays:[],srs:{},history:{[today()]:1},xp:10}}};');
assert.equal(run('todayXp()'),30,'today XP adds both dialects, 10 XP per sentence');
assert.equal(run('weekDays().filter(d=>d.today).length'),1,'the week strip marks exactly one today');

// 오늘 첫 학습: 완료 → 스트릭 → 목표(30 XP) → 홈
run('state={dialect:"egypt",progress:{},dailyGoal:30}; startLesson(1); lesson.graded=6; lesson.correct=5; finishLesson();');
assert.match(run('html'),/83%/,'accuracy is correct / graded');
assert.match(run('html'),/\+30/);
onClick();
assert.equal(run('shown.join()'),'streak,goal,home','first lesson of the day shows streak, then the goal reached');

// 같은 날 두 번째 학습: 스트릭·목표는 이미 지나서 바로 홈
run('shown=[]; startLesson(2); finishLesson();');
onClick();
assert.equal(run('shown.join()'),'home','celebrations appear only once a day');

// 목표 60 XP: 두 번째 학습에서 목표를 넘는 순간에만 목표 화면
run('shown=[]; state={dialect:"egypt",progress:{},dailyGoal:60}; startLesson(1); finishLesson();');
onClick();
assert.equal(run('shown.join()'),'streak,home');
run('shown=[]; startLesson(2); finishLesson();');
onClick();
assert.equal(run('shown.join()'),'goal,home','goal screen appears when the goal is crossed');

// 연습 문제가 없는 학습은 정확도를 보여 주지 않는다
run('state={dialect:"egypt",progress:{}}; startLesson(1); finishLesson();');
assert.doesNotMatch(run('html'),/정확도/);
console.log('PASS: daily goal values, today XP across dialects, accuracy, streak then goal order, once-a-day celebrations');
