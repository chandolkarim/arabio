const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const node = { addEventListener(){}, querySelectorAll(){return []}, style:{setProperty(){}}, classList:{remove(){}}, innerHTML:'' };
const context = vm.createContext({ console, document:{getElementById:()=>node,addEventListener(){},querySelector(){return null}}, window:{}, localStorage:{getItem(){return null},setItem(){}}, setTimeout(){}, clearTimeout(){}, requestAnimationFrame:fn=>fn() });
vm.runInContext(fs.readFileSync('web/app.js','utf8').split('(async function boot()')[0],context);
context.fixture = JSON.parse(fs.readFileSync('web/data/sentences.json','utf8'));
const run = code => vm.runInContext(code,context);
run('DATA=fixture; state={dialect:"egypt",progress:{}}; renderStep=()=>{}; let noHearts=[]; screenNoHearts=day=>noHearts.push(day); let healed=[]; screenHealed=day=>healed.push(day); show=()=>{};');
const H = 3 * 60 * 60 * 1000;

assert.equal(run('hearts().count'),5,'new learners start with full hearts');
assert.equal(run('loseHeart(1000)'),4);
assert.equal(run('state.hearts.refillAt'),1000 + H,'first loss starts the refill clock');
assert.equal(run('loseHeart(2000)'),3);
assert.equal(run('state.hearts.refillAt'),1000 + H,'later losses keep the running clock');
assert.equal(run(`hearts(${1000 + H - 1}).count`),3,'no refill before the interval');
assert.equal(run(`hearts(${1000 + H}).count`),4,'one heart per interval');
assert.equal(run(`hearts(${1000 + 10 * H}).count`),5,'refill never exceeds the maximum');
assert.equal(run('state.hearts.refillAt'),null,'full hearts stop the clock');

const restored = run('normalizeState({hearts:{count:9,refillAt:5}}).hearts');
assert.equal(restored.count,5,'stored count is clamped');
assert.equal(restored.refillAt,null);
assert.ok(run('normalizeState({hearts:{count:2}}).hearts.refillAt') > Date.now(),'missing clock is repaired so hearts still refill');

assert.equal(run('costsHearts("lesson") && costsHearts("again")'),true);
assert.equal(run('costsHearts("review") || costsHearts("heal")'),false,'review and heal practice never cost hearts');

run('state.hearts={count:0,refillAt:Date.now()+1000}; lesson=null; startLesson(1);');
assert.equal(run('lesson'),null,'a lesson cannot start without hearts');
assert.equal(run('noHearts.join()'),'1');
run('startLesson(1, sentencesOfDay(1), "review");');
assert.equal(run('lesson.mode'),'review','review is still open without hearts');

run('state.hearts={count:1,refillAt:null}; startLesson(1); lesson.mistakes={"002":true}; loseHeart(); next=()=>{};');
assert.equal(run('healList(1).map(s=>s.id).join()'),'002','heal practice starts with the sentences just missed');
run('startLesson(1, healList(1), "heal", 1); finishLesson();');
assert.equal(run('hearts().count'),5,'heal practice refills every heart');
assert.equal(run('healed.join()'),'1');
assert.equal(run('Object.keys(progress().srs).length + progress().xp'),0,'heal practice does not touch progress, SRS or XP');

run('state.hearts={count:3,refillAt:Date.now()+HEART_REFILL_MS}; startLesson(null, sentencesOfDay(1), "review"); finishLesson();');
assert.equal(run('hearts().count'),4,'finishing a review gives one heart');
console.log('PASS: heart loss, timed refill, stored-state repair, lesson lock at zero, heal practice refill, review bonus');
