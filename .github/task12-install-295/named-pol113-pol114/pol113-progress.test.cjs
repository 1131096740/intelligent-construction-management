'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const Progress=require('./pol113-progress.cjs');

test('retains only bounded Playwright milestones and survives a partial final record',t=>{
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'pol113-progress-test-'));
  t.after(()=>fs.rmSync(work,{recursive:true}));
  const file=path.join(work,'progress.jsonl');
  const reporter=new Progress({file,startedAt:Date.now()});
  const playTest={titlePath:()=>['desktop','profile','https://synthetic.invalid/token'],parent:{project:()=>({name:'desktop'})}};
  reporter.onBegin({}, {allTests:()=>[playTest]});
  reporter.onTestBegin(playTest);
  reporter.onTestEnd(playTest,{status:'timedOut',duration:45_000,error:{message:'private: https://synthetic.invalid/token'}});
  reporter.onError({message:'private: browser stderr'});
  reporter.onEnd({status:'failed'});
  fs.appendFileSync(file,'{"event":"CASE_START"');
  const rows=Progress.readProgress(file);
  assert.deepEqual(rows.map(x=>x.event),['SUITE_START','CASE_START','CASE_END','RUN_ERROR','SUITE_END']);
  assert.equal(rows[2].status,'timedOut');
  assert.equal(rows[2].durationMs,45_000);
  assert.equal(rows[1].project,'desktop');
  assert.equal(rows[1].caseSha256,rows[2].caseSha256);
  assert.match(rows[1].caseSha256,/^[0-9a-f]{64}$/u);
  assert.ok(!/https|private|token/u.test(fs.readFileSync(file,'utf8')));
});

test('classifies executor and Jest deadlines independently',()=>{
  assert.equal(Progress.executorOutcome({error:{code:'ETIMEDOUT'},signal:'SIGTERM'}),'DEADLINE');
  assert.equal(Progress.executorOutcome({signal:'SIGTERM'}),'SIGNALLED');
  assert.equal(Progress.executorOutcome({error:{code:'secret-error'}}),'SPAWN_ERROR');
  assert.equal(Progress.hasJestDeadline(['Exceeded timeout of 210000 ms for a test.']),true);
  assert.equal(Progress.hasJestDeadline(['locator timed out after 45000 ms']),false);
});
