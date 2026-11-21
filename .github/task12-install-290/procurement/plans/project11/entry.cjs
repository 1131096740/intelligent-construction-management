'use strict';

try {
  if (process.env.DATABASE_URL || process.env.NODE_ENV==='production') throw Error('PROCUREMENT_289_UNEXPECTED_ENV');
  require('./input-check.cjs').verify();
  if (process.argv.length===3 && process.argv[2]==='--admission-only') {
    const workDir=require('node:fs').mkdtempSync('/tmp/jg394-');
    const web=require('./stage-procurement.cjs').stageProcurementWorkspace(workDir);
    require('./project-scope-browser-report.cjs').assertProjectBrowserInputs(web);
    const listed=require('node:child_process').spawnSync('pnpm',['exec','playwright','test','--list',
      '--config','playwright.project-business-scope.config.ts'],{
      cwd:web,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
      env:{PATH:process.env.PATH,HOME:workDir,TMPDIR:workDir,COREPACK_HOME:'/opt/corepack',
        COREPACK_ENABLE_NETWORK:'0',COREPACK_DEFAULT_TO_LATEST:'0',PLAYWRIGHT_BROWSERS_PATH:'/opt/jg-playwright',
        PROJECT_SCOPE_API:'http://127.0.0.1:1',PROJECT_SCOPE_SESSIONS:'{}'}
    });
    if(listed.status!==0||!listed.stdout.includes('Total: 4 tests in 1 file')||
        (listed.stdout.match(/\[desktop\]/gu)?.length??0)!==2||
        (listed.stdout.match(/\[mobile\]/gu)?.length??0)!==2) {
      throw Error('PROJECT_SCOPE_289_BROWSER_LIST');
    }
    console.log(JSON.stringify({status:'PROJECT_SCOPE_289_BROWSER_INPUTS_ADMITTED',postgresStarted:false,browserCases:{desktop:2,mobile:2}}));
  } else if (process.argv.length===2) {
    require('./consumer.cjs');
  } else {
    throw Error('PROCUREMENT_289_ENTRY_ARGUMENTS');
  }
} catch(error) {
  const code = error?.message;
  console.log(JSON.stringify({status:'STOPPED',stage:'INPUTS',code:/^[A-Z0-9_]+$/u.test(code??'')?code:'PROCUREMENT_289_INPUTS'}));
  process.exitCode=1;
}
