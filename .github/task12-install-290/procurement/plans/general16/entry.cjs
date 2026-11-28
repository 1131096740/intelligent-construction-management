'use strict';

try {
  if (process.env.DATABASE_URL || process.env.NODE_ENV==='production') throw Error('PROCUREMENT_289_UNEXPECTED_ENV');
  require('./input-check.cjs').verify();
  if (process.argv.length===3 && process.argv[2]==='--admission-only') {
    console.log(JSON.stringify({status:'PROCUREMENT_289_IMAGE_AND_ARCHIVE_ADMITTED',postgresStarted:false}));
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
