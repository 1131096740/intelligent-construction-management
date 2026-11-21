'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {records,cases}=require('./project-scope-browser-pins.json');
const projects=['desktop','mobile'];

function assertProjectBrowserInputs(webRoot) {
  for(const {file,sha} of records) {
    const required=path.join(webRoot,file);
    if(!fs.existsSync(required)||!fs.lstatSync(required).isFile()||
      createHash('sha256').update(fs.readFileSync(required)).digest('hex')!==sha) {
      throw new Error('PROJECT_SCOPE_BROWSER_INPUTS');
    }
  }
}

function observeProjectBrowserReport(reportPath) {
  const partial={report:false,complete:false,rows:[]};
  try {
    if(!fs.lstatSync(reportPath).isFile()||fs.statSync(reportPath).size>2*1024*1024)return partial;
    const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
    const pending=[...report.suites],seen=new Map();
    let suites=0;
    while(pending.length&&++suites<=16) {
      const node=pending.shift();
      pending.push(...(node.suites??[]));
      for(const spec of node.specs??[]) {
        if(path.basename(spec.file)!=='project-business-scope-real.e2e.ts')return partial;
        const selected=cases.find(c=>c.title===spec.title&&c.line===spec.line);
        if(!selected)return partial;
        for(const test of spec.tests) {
          const key=selected.id+':'+test.projectName;
          if(!projects.includes(test.projectName)||seen.has(key)||test.results?.length!==1)return partial;
          const raw=test.results[0].status;
          const status=test.status==='expected'&&test.expectedStatus==='passed'&&raw==='passed'?'PASSED':
            raw==='timedOut'?'TIMED_OUT':raw==='failed'?'FAILED':
              raw==='skipped'?'UNEXPECTED_SKIP':raw==='interrupted'?'INTERRUPTED':'OTHER';
          seen.set(key,status);
        }
      }
    }
    if(pending.length)return partial;
    const rows=cases.flatMap(c=>projects.map(project=>({id:c.id,project,status:seen.get(c.id+':'+project)??'MISSING'})));
    return {report:true,complete:rows.every(r=>r.status==='PASSED')&&report.stats?.expected===4&&
      report.stats.skipped===0&&report.stats.unexpected===0&&report.stats.flaky===0,rows};
  } catch {return partial;}
}
module.exports={assertProjectBrowserInputs,observeProjectBrowserReport};
