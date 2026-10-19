const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {mkdtempSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {tmpdir}=require('node:os');
const cwd=resolve(__dirname,'..');
const artifacts=mkdtempSync(join(tmpdir(),'jg-contract-check-'));
// Always create disposable local PostgreSQL 16; inherited connection targets are forbidden.
function run(bin,args,env=process.env){const r=spawnSync(bin,args,{cwd,env,encoding:'utf8',maxBuffer:64*1024*1024}); if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr); if(r.status!==0)throw new Error('Local command failed: '+bin+' '+args[0]);return r.stdout;}
if(process.env.NODE_ENV==='production'||Object.keys(process.env).some(k=>k==='DATABASE_URL'||k.endsWith('_DATABASE_URL')))throw Error('Refuse inherited database target');
const endpoint=run('docker',['context','inspect','--format','{{.Endpoints.docker.Host}}']).trim();
if(!endpoint.startsWith('unix://')||(process.env.DOCKER_HOST&&!process.env.DOCKER_HOST.startsWith('unix://')))throw Error('Local Docker socket required');
process.env.DOCKER_HOST=endpoint; delete process.env.DOCKER_CONTEXT;
const name='jg-contract-test-'+randomUUID().slice(0,8),password=randomUUID(),db='jiangkong_project_affiliate_company_contract_test';
const env={...process.env,POSTGRES_PASSWORD:password};
try{
 run('docker',['run','--rm','--detach',"--pull=never",'--name',name,'--env','POSTGRES_USER=jiangkong','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB='+db,'--publish','127.0.0.1::5432',"postgres:16"],env);
 const port=run('docker',['port',name,'5432/tcp']).trim().split(':').pop();
 let ready=false;
 for(let i=0;i<40;i++){const r=spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','jiangkong','-d',db]);if(r.status===0){ready=true;break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);}
 if(!ready)throw Error('Disposable PostgreSQL TCP server did not become ready');
 const target='postgresql://jiangkong:'+password+'@127.0.0.1:'+port+'/'+db;
 let testEnv={...process.env,NODE_ENV:'test',DATABASE_URL:target,PROJECT_AFFILIATE_COMPANY_CONTRACT_DATABASE_URL:target,RUN_PROJECT_AFFILIATE_COMPANY_CONTRACT_DB_TESTS:'1',OPERATING_LEDGER_DB_WRITE_SECRET:randomUUID(),FILE_STORAGE_DRIVER:"local",FILE_STORAGE_ROOT:join(artifacts,"files"),INITIAL_USER_TEMPORARY_PASSWORD:"Local-Transfer-Initial-01",SMS_ENABLED:"false",RUN_COMPANY_TRANSFER_HTTP:"1"};
 run('pnpm',['exec','prisma','migrate','deploy'],testEnv);
 run('pnpm',['exec','prisma','migrate','deploy'],testEnv);
 testEnv.CONTRACT_BANK_RUNTIME_DATABASE_URL=require('./contract-bank-runtime-fixture.cjs').prepareContractBankRuntime({name,db,password,target});
 run('pnpm',['exec','jest','--runInBand','src/database/project-affiliate-company-contract-db.spec.ts','--json','--outputFile',join(artifacts,'contract-tests.json')],testEnv);
 run('docker',['exec',name,'pg_dump','-U','contract_backup','-d',db,'-Fc','-f','/tmp/contract-backup.dump']);
 run('docker',['exec',name,'createdb','-U','jiangkong','contract_restored']);
 run('docker',['exec',name,'pg_restore','--exit-on-error','--no-owner','-U','jiangkong','-d','contract_restored','/tmp/contract-backup.dump']);
 run('docker',['exec',name,'psql','-v','ON_ERROR_STOP=1','-U','contract_backup','-d','contract_restored','-f','/tmp/backup-role.sql']);
 const restored=run('docker',['exec',name,'psql','-At','-U','jiangkong','-d','contract_restored','-c',`
   SELECT count(*)>0 FROM "ContractBankVerificationRequest" WHERE status='confirmed';
   SELECT has_function_privilege('contract_runtime','issue_contract_bank_holder(text,text,text,text,text,text)','EXECUTE'),has_function_privilege('contract_backup','issue_contract_bank_holder(text,text,text,text,text,text)','EXECUTE');
 `]).trim();
 if(restored!=="t\nt|f") throw Error('Restored bank facts and role ACL must survive the complete backup');
 const coreDb='jiangkong_pol114';
 run('docker',['exec',name,'createdb','-U','jiangkong',coreDb]);
 const coreEnv={...testEnv,DATABASE_URL:target.replace('/'+db,'/'+coreDb),RUN_POL114_HTTP_PG16:'1',RUN_POL114_SETTLEMENT_FINANCE_HTTP_PG16:'1',RUN_POL114_PAYMENT_HTTP_PG16:'1',COMPANY_TRANSFER_CORE_RECEIPT:join(artifacts,'core-fixture.json')};
 run('pnpm',['exec','prisma','migrate','deploy'],coreEnv);
 run('pnpm',['exec','jest','--runInBand','src/database/contract-business-entry-http.spec.ts','--testNamePattern','合同现役提交与旧入口退出：aggregate','--json','--outputFile',join(artifacts,'core-tests.json')],coreEnv);
 run('pnpm',['exec','jest','--runInBand','src/database/company-transfer-http-postgres.spec.ts','--json','--outputFile',join(artifacts,'role-tests.json')],coreEnv);
 const paymentDb='jiangkong_payment_execution_concurrency';
 run('docker',['exec',name,'createdb','-U','jiangkong',paymentDb]);
 testEnv={...testEnv,DATABASE_URL:target.replace('/'+db,'/'+paymentDb),RUN_PAYMENT_EXECUTION_CONCURRENCY:'1'};
 run('pnpm',['exec','prisma','migrate','deploy'],testEnv);
 run('pnpm',['exec','jest','--runInBand','src/database/payment-execution-concurrency.spec.ts','--json','--outputFile',join(artifacts,'payment-tests.json')],testEnv);
 console.log('Test receipts: '+artifacts);
 console.log('ISOLATED CONTRACT FINANCE CHECK PASS; synthetic empty database only; exact-SHA CI evidence requires the outer dynamic gate');
}finally{run('docker',['rm','--force',name]);}
