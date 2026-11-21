'use strict';

const fs=require('node:fs');
const path=require('node:path');

const retainedSkip='项目页加载后撤回本项目岗位，保存及后续目标预检冻结均按当前权限失败且其他项目不变';

const bootClasses=[
  ["READ_ONLY_FS",/EROFS|read-only file system/iu],
  ["FS_PERMISSION",/EACCES|permission denied/iu],
  ["MODULE_NOT_FOUND",/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|cannot find (?:module|package)/iu],
  ["VITE_CONFIG_LOAD",/failed to load config/iu],
  ["WEB_SERVER_EXIT",/Process from config\.webServer was not able to start/iu],
  ["WEB_SERVER_TIMEOUT",/Timed out waiting .* config\.webServer/iu],
  ["NO_TESTS",/no tests found/iu],
  ["PORT_IN_USE",/EADDRINUSE|port .* is already in use/iu],
  ["BROWSER_MISSING",/Executable doesn't exist|Host system is missing dependencies/iu]
];
function bootSummary(errorValues) {
  const messages=errorValues.filter(value=>typeof value==="string").map(value=>value.slice(0,16384));
  return {count:messages.length,classes:bootClasses.filter(([,pattern])=>messages.some(text=>pattern.test(text))).map(([name])=>name)};
}

function reportSummaries(workDir,prefix){
  const match=new RegExp('^'+prefix+'-[a-f0-9-]{36}\\.json$','u');
  return fs.readdirSync(workDir).filter(file=>match.test(file)).map(file=>{
    const target=path.join(workDir,file);
    const stat=fs.lstatSync(target);
    if(!stat.isFile()||stat.size>32*1024*1024)throw Error('POL113_POL114_BROWSER_REPORT');
    const report=JSON.parse(fs.readFileSync(target,'utf8'));
    const visit=suite=>[
      ...(suite.specs??[]).flatMap(spec=>spec.tests.map(test=>({
        title:spec.title,project:test.projectName,status:test.status,runs:test.results.map(run=>run.status),
      }))),
      ...(suite.suites??[]).flatMap(visit),
    ];
    const rows=report.suites.flatMap(visit);
    const passed=rows.filter(row=>row.status==='expected'&&row.runs.length===1&&row.runs[0]==='passed');
    const skipped=rows.filter(row=>row.status==='skipped');
    const counts=Object.create(null);
    for(const row of passed)counts[row.project]=(counts[row.project]??0)+1;
    return {boot:bootSummary((Array.isArray(report.errors)?report.errors:[]).slice(0,32).map(error=>error?.message)),
      total:rows.length,passed:passed.length,skipped:skipped.length,byProject:counts,
      unexpected:report.stats.unexpected,flaky:report.stats.flaky,reportedSkipped:report.stats.skipped,
      originalMobileSkip:skipped.length===1&&skipped[0].title===retainedSkip&&skipped[0].project==='mobile'&&
        passed.some(row=>row.title===retainedSkip&&row.project==='desktop')};
  });
}

function isPair(report,desktop,mobile){
  return report.total===2&&report.passed===2&&report.skipped===0&&report.reportedSkipped===0&&
    report.unexpected===0&&report.flaky===0&&report.byProject[desktop]===1&&report.byProject[mobile]===1;
}

function collectBrowserEvidence(workDir,mode){
  if(mode==='pol113'){
    const reports=reportSummaries(workDir,'pol113');
    const outcome=reports[0];
    const exact=reports.length===1&&outcome.total===24&&outcome.passed===23&&outcome.skipped===1&&
      outcome.byProject.desktop===12&&outcome.byProject.mobile===11&&outcome.unexpected===0&&
      outcome.flaky===0&&outcome.reportedSkipped===1&&outcome.originalMobileSkip;
    return {exact,project:reports};
  }
  if(mode!=='pol114')throw Error('POL113_POL114_NAMED_PURPOSE');
  const layout=reportSummaries(workDir,'pol114-layout');
  const settlement=reportSummaries(workDir,'pol114-settlement');
  return {exact:layout.length===1&&isPair(layout[0],'desktop','mobile')&&settlement.length===8&&
    settlement.every(report=>isPair(report,'chromium','webkit-mobile')),layout,settlement};
}

module.exports={collectBrowserEvidence,bootSummary};
