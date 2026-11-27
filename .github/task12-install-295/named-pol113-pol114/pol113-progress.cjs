'use strict';

const fs=require('node:fs');
const {createHash}=require('node:crypto');

const maxEvents=64;
const events=['SUITE_START','CASE_START','CASE_END','RUN_ERROR','SUITE_END'];
const projects=['desktop','mobile'];
const outcomes=['passed','failed','timedOut','skipped','interrupted'];
const failureKinds=['ASSERTION','BROWSER_CLOSED','TIMEOUT','NETWORK_ERROR','UNCLASSIFIED'];

function safeEvent(row) {
  if(!row||!events.includes(row.event)||!Number.isSafeInteger(row.elapsedMs)||row.elapsedMs<0) return undefined;
  const event={event:row.event,elapsedMs:row.elapsedMs};
  if(Number.isSafeInteger(row.cases)&&row.cases>=0&&row.cases<=1000) event.cases=row.cases;
  if(projects.includes(row.project)) event.project=row.project;
  if(typeof row.caseSha256==='string'&&/^[a-f0-9]{64}$/u.test(row.caseSha256)) event.caseSha256=row.caseSha256;
  if(outcomes.includes(row.status)) event.status=row.status;
  if(Number.isSafeInteger(row.durationMs)&&row.durationMs>=0) event.durationMs=row.durationMs;
  if(failureKinds.includes(row.failureKind)) event.failureKind=row.failureKind;
  if(Number.isSafeInteger(row.failureLine)&&row.failureLine>0&&row.failureLine<=10000) event.failureLine=row.failureLine;
  return event;
}

function caseIdentity(test) {
  return {
    project:test.parent.project()?.name,
    caseSha256:createHash('sha256').update(JSON.stringify(test.titlePath())).digest('hex'),
  };
}

function failureIdentity(test,result) {
  const error=result.errors?.[0]??result.error;
  if(!error&&result.status!=='timedOut') return {};
  const message=typeof error?.message==='string'?error.message.slice(0,4096):'';
  let failureKind='UNCLASSIFIED';
  if(/(?:target|page|context|browser).*has been closed/iu.test(message)) failureKind='BROWSER_CLOSED';
  else if(result.status==='timedOut'||/TimeoutError|Timeout [0-9]+ms exceeded|timed out/iu.test(message)) failureKind='TIMEOUT';
  else if(error?.matcherResult||/\bexpect\(|AssertionError/u.test(message)) failureKind='ASSERTION';
  else if(/net::ERR_|ECONNREFUSED|ERR_CONNECTION/iu.test(message)) failureKind='NETWORK_ERROR';
  const failureLine=error?.location?.file===test.location?.file?error?.location?.line:undefined;
  return {failureKind,failureLine};
}

class Progress {
  constructor({file,startedAt}){
    this.file=file;
    this.startedAt=startedAt;
    this.eventsWritten=0;
  }

  emit(event,detail){
    if(this.eventsWritten>=maxEvents) return;
    const row=safeEvent({event,elapsedMs:Math.max(0,Date.now()-this.startedAt),...detail});
    if(!row) return;
    fs.appendFileSync(this.file,JSON.stringify(row)+'\n',{mode:0o600});
    this.eventsWritten++;
  }

  onBegin(_config,suite){ this.emit('SUITE_START',{cases:suite.allTests().length}); }
  onTestBegin(test){ this.emit('CASE_START',caseIdentity(test)); }
  onTestEnd(test,result){
    this.emit('CASE_END',{...caseIdentity(test),status:result.status,durationMs:result.duration,...failureIdentity(test,result)});
  }
  onError(){ this.emit('RUN_ERROR'); }
  onEnd(result){ this.emit('SUITE_END',{status:result.status}); }
  printsToStdio(){ return false; }
}

function readProgress(file){
  const stat=fs.lstatSync(file,{throwIfNoEntry:false});
  if(!stat?.isFile()||stat.size>32*1024) return [];
  const lines=fs.readFileSync(file,'utf8').split('\n');
  lines.pop();
  return lines.slice(0,maxEvents).flatMap(line=>{
    try {
      const row=safeEvent(JSON.parse(line));
      return row?[row]:[];
    } catch (error) {
      if(error instanceof SyntaxError) return [];
      throw error;
    }
  });
}

function executorOutcome(result){
  if(result.error?.code==='ETIMEDOUT') return 'DEADLINE';
  if(result.error?.code==='ENOBUFS') return 'OUTPUT_LIMIT';
  if(result.error) return 'SPAWN_ERROR';
  if(result.signal) return 'SIGNALLED';
  return result.status===0?'SUCCESS':'EXITED';
}

function hasJestDeadline(traces){
  return traces.some(value=>typeof value==='string'&&/Exceeded timeout of \d+\s?ms for a test/u.test(value));
}

module.exports=Progress;
module.exports.readProgress=readProgress;
module.exports.executorOutcome=executorOutcome;
module.exports.hasJestDeadline=hasJestDeadline;
