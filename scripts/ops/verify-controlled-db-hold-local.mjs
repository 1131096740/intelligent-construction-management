import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,realpathSync,existsSync} from 'node:fs';
import {dirname,isAbsolute,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const image='postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d';
// Actual isolated PG16 connection-control probe; no business Schema, credentials,
// remote Docker, production ACL adapter or external client is used.
assert(process.argv.length===4&&process.argv[2]==='--receipt-dir','private receipt directory required');
const root=process.argv[3],temporary=[realpathSync(tmpdir()),realpathSync('/tmp')];
assert(isAbsolute(root)&&!existsSync(root)&&temporary.some(p=>root.startsWith(p+sep))&&realpathSync(dirname(root))===dirname(root),'new canonical temporary evidence directory required');
assert(!process.env.DOCKER_HOST||process.env.DOCKER_HOST.startsWith('unix:'),'local Docker only');
mkdirSync(root,{mode:0o700});const runId='pol25a-writer-hold-'+Date.now(),name=runId,role='local_fixture_writer';
const state={executionScope:'isolated-local',status:'running',runId,image,checks:[],productionAccessed:false,freezeVerified:false,productionAuthorityReceipt:false};
const save=()=>writeFileSync(root+'/status.json',JSON.stringify(state,null,2)+'\n',{mode:0o600});save();
let container,keeper,client;
function run(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:15000,maxBuffer:1024*1024});if(r.error)throw r.error;return r;}
function okay(args,input){const r=run(args,input);assert.equal(r.status,0,String(r.stderr).slice(0,1000));return r.stdout.trim();}
function sql(query,user='postgres'){return run(['exec','-i',container,'psql','-X','-h','127.0.0.1','-U',user,'-d','postgres','-At','-v','ON_ERROR_STOP=1'],query+'\n');}
function query(q){const r=sql(q);assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function unixSql(q,{databaseUser='postgres',osUser}={}){
 const r=run(['exec',...(osUser?['-u',osUser]:[]),'-i',container,'psql','-X','-h','/var/run/postgresql','-U',databaseUser,'-d','postgres','-At','-v','ON_ERROR_STOP=1'],q+'\n');return r;
}
function maintenanceQuery(q){const r=unixSql(q,{osUser:'postgres'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
function replicationSql(host,osUser){
 return run(['exec',...(osUser?['-u',osUser]:[]),'-i',container,'psql','-X','-h',host,'-U','postgres','-d','replication=true','-At','-v','ON_ERROR_STOP=1'],'IDENTIFY_SYSTEM;\n');
}
const digest=value=>createHash('sha256').update(value).digest('hex');
function check(name){state.checks.push(name);save();}
try{
 const context=okay(['context','inspect','--format','{{.Endpoints.docker.Host}}']);assert(context.startsWith('unix:'),'local context endpoint required');
 const inspection=run(['image','inspect',image]);
 writeFileSync(root+'/image-before.log',inspection.stdout+'\n'+inspection.stderr,{mode:0o600});
 if(inspection.status!==0){
  assert(!okay(['ps','--filter','label=jiangkong.pol25a-local-keeper','--format','{{.ID}}']),'existing keeper requires coordination');
  const cached=okay(['image','ls','--digests','--format','{{.Repository}} {{.Tag}} {{.Digest}}']);assert(cached.includes('postgres 16 '+image.split('@')[1]),'confirmed cached official image required');
  keeper=okay(['run','--rm','-d','--pull=never','--name',name+'-keeper','--label','jgzg.pol25a.writer-hold='+runId,'--label','jiangkong.pol25a-local-keeper=true','--read-only','--network','none',image,'sleep','1800']);
 }
 okay(['image','inspect',image]);check('fixed-official-local-image');
 container=okay(['run','-d','--pull=never','--name',name,'--label','jgzg.pol25a.writer-hold='+runId,'--network','none','--read-only','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=256m','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,size=8m','--tmpfs','/tmp:rw,nosuid,nodev,size=16m','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 assert(/^[a-f0-9]{64}$/u.test(container));state.containerId=container;save();
 let ready=false;for(let i=0;i<60;i++){if(run(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,100));}assert(ready,'PG16 TCP readiness');
 assert.equal(query('SHOW server_version_num').slice(0,2),'16');check('actual-pg16-ready-no-port-or-network');
 const productionScript=fileURLToPath(new URL('./controlled-database-hold.py',import.meta.url));
 const identityPin=query("SELECT encode(sha256(convert_to(system_identifier::text||'|postgres|public','UTF8')),'hex') FROM pg_control_system()");
 const identityCommand=spawnSync('python3',['-B','-c', `import importlib.util,sys
s=importlib.util.spec_from_file_location('hold',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.identity_sql(sys.argv[2]))`,productionScript,identityPin],{encoding:'utf8'});
 assert.equal(identityCommand.status,0,identityCommand.stderr);
 const actualIdentity=JSON.parse(query(identityCommand.stdout));assert.equal(actualIdentity.database,'postgres');assert.equal(actualIdentity.foreignDatabases,0);check('actual-production-identity-query-on-pg16');
 query('CREATE DATABASE unexpected_fixture');const otherIdentity=JSON.parse(query(identityCommand.stdout));assert.equal(otherIdentity.foreignDatabases,1);query('DROP DATABASE unexpected_fixture');check('foreign-database-cluster-scope-is-detected');
 query('CREATE DATABASE \"jiangkongXrestoreYother\"');assert.equal(JSON.parse(query(identityCommand.stdout)).foreignDatabases,1);query('DROP DATABASE \"jiangkongXrestoreYother\"');check('restore-prefix-wildcard-near-match-is-not-exempt');
 // Execute the actual preflight metadata SQL against PG16, rather than relying
 // only on the command-adapter fixture. No production connection is involved.
 const preflight=fileURLToPath(new URL('./controlled-launch-preflight.py',import.meta.url));
 const extracted=spawnSync('python3',['-B','-c',`import ast,json,sys
tree=ast.parse(open(sys.argv[1]).read());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
queries=[n.value.args[0] for n in main.body if isinstance(n,ast.Assign) and isinstance(n.value,ast.Call) and isinstance(n.value.func,ast.Name) and n.value.func.id=='query']
assert len(queries)==3
print(json.dumps([eval(compile(ast.Expression(n),'<readonly-sql>','eval'),{'__builtins__':{},'DATABASE':sys.argv[2]}) for n in queries]))`,preflight,identityPin],{encoding:'utf8'});
 assert.equal(extracted.status,0,extracted.stderr);const metadataSql=JSON.parse(extracted.stdout);
 assert.equal(JSON.parse(query(metadataSql[0])).database,'postgres');check('actual-preflight-target-sql-pg16');
 const permissions=JSON.parse(query(metadataSql[1]));assert.equal(permissions.backupRole,null);assert(Array.isArray(permissions.defaultPrivileges));check('actual-preflight-permission-sql-pg16');
 query('CREATE TABLE public."_prisma_migrations" (migration_name text, checksum text, finished_at timestamptz, rolled_back_at timestamptz)');
 assert.deepEqual(JSON.parse(query(metadataSql[2])),[]);check('actual-preflight-migration-sql-pg16');
 query('CREATE ROLE '+role+' LOGIN');assert.equal(sql('SELECT current_user',role).stdout.trim(),role);check('writer-login-before-hold');
 client=spawn('docker',['exec','-e','PGAPPNAME=pol25a-local-existing-writer',container,'psql','-X','-h','127.0.0.1','-U',role,'-d','postgres','-At','-v','ON_ERROR_STOP=1','-c','SELECT pg_sleep(60)'],{stdio:['ignore','pipe','pipe']});
 let clientError='';client.stderr.on('data',b=>{clientError+=b.toString();});client.stdout.resume();
 const exited=new Promise((resolve,reject)=>{client.once('error',reject);client.once('exit',(code,signal)=>resolve({code,signal}));});
 const count=()=>query("SELECT count(*) FROM pg_stat_activity WHERE application_name='pol25a-local-existing-writer' AND usename='"+role+"'");
 let connected=false;for(let i=0;i<30;i++){if(count()==='1'){connected=true;break;}await new Promise(r=>setTimeout(r,100));}assert(connected,'existing actual writer connection');check('existing-actual-writer-session');
 query('ALTER ROLE '+role+' NOLOGIN');assert.notEqual(sql('SELECT 1',role).status,0);check('nologin-blocks-new-writer-connections');
 assert.equal(count(),'1');check('nologin-alone-does-not-drain-existing-session');
 assert.equal(query("SELECT bool_and(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE application_name='pol25a-local-existing-writer' AND usename='"+role+"'"),'t');
 const outcome=await exited;assert.notEqual(outcome.code,0);assert(/terminating connection|closed the connection/u.test(clientError));assert.equal(count(),'0');check('explicit-drain-terminates-actual-existing-writer');
 assert.notEqual(sql('SELECT 1',role).status,0);check('writer-reconnect-stays-denied-during-window');
 assert.equal(query('SELECT current_user'),'postgres');check('administrator-still-connects-so-complete-freeze-unproven');
 query('ALTER ROLE '+role+' LOGIN');assert.equal(sql('SELECT current_user',role).stdout.trim(),role);check('exact-local-login-state-rollback');
 // Real authentication fence: ordinary users and TCP superusers are rejected.
 // OS postgres remains a controlled maintenance channel, not a full write freeze.
 const hbaPath=query('SHOW hba_file');assert.equal(hbaPath,'/var/lib/postgresql/data/pg_hba.conf');
 const before=run(['exec',container,'cat',hbaPath]);assert.equal(before.status,0,before.stderr);
 writeFileSync(root+'/hba-before.private',before.stdout,{mode:0o600});
 const script=fileURLToPath(new URL('./controlled-database-hold.py',import.meta.url));
 const prepared=spawnSync('python3',['-c', `import importlib.util,sys
s=importlib.util.spec_from_file_location('hold',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sys.stdout.buffer.write(m.hold_bytes(sys.stdin.buffer.read(),'postgres'))`,script],{input:before.stdout,encoding:'utf8'});
 assert.equal(prepared.status,0,prepared.stderr);const held=prepared.stdout;
 query("CREATE ROLE jiangkong_backup_reader LOGIN PASSWORD 'fixture-only-reader'");
 assert.equal(unixSql('SELECT current_user',{databaseUser:role}).status,0);check('ordinary-unix-writer-before-hba-hold');
 assert.equal(replicationSql('127.0.0.1').status,0);check('actual-tcp-physical-replication-before-hold');
 assert.equal(replicationSql('/var/run/postgresql','postgres').status,0);check('actual-unix-physical-replication-before-hold');
 const bootstrapPrepared=spawnSync('python3',['-B','-c',`import importlib.util,sys
s=importlib.util.spec_from_file_location('hold',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sys.stdout.buffer.write(m.hold_bytes(sys.stdin.buffer.read(),'postgres',backup_enabled=False))`,script],{input:before.stdout,encoding:'utf8'});
 assert.equal(bootstrapPrepared.status,0,bootstrapPrepared.stderr);
 okay(['exec','-i',container,'tee',hbaPath],bootstrapPrepared.stdout);assert.equal(maintenanceQuery('SELECT pg_reload_conf()'),'t');await new Promise(r=>setTimeout(r,100));
 const bootstrapReader=spawnSync('docker',['exec','-e','PGPASSWORD=fixture-only-reader',container,'psql','-X','-h','127.0.0.1','-U','jiangkong_backup_reader','-d','postgres','-Atc','SELECT current_user'],{encoding:'utf8'});
 assert.notEqual(bootstrapReader.status,0);assert.match(bootstrapReader.stderr,/pg_hba.conf rejects connection/);check('bootstrap-fence-denies-even-configured-reader');
 assert.equal(maintenanceQuery('SELECT current_user'),'postgres');check('bootstrap-keeps-only-approved-os-postgres-maintenance-channel');
 okay(['exec','-i',container,'tee',hbaPath],held);
 assert.equal(maintenanceQuery('SELECT pg_reload_conf()'),'t');await new Promise(r=>setTimeout(r,100));
 const rejected=(r,pattern)=>{assert.notEqual(r.status,0);assert.match(r.stderr,pattern);};
 rejected(sql('SELECT 1',role),/pg_hba.conf rejects connection/u);check('hba-rejects-new-tcp-runtime');
 rejected(sql('SELECT 1'),/pg_hba.conf rejects connection/u);check('hba-rejects-new-tcp-superuser');
 rejected(unixSql('SELECT 1',{databaseUser:role}),/pg_hba.conf rejects connection/u);check('hba-rejects-ordinary-unix-writer');
 rejected(unixSql('SELECT 1'),/Peer authentication failed/u);check('default-root-client-peer-authentication-refuses-claimed-postgres');
 rejected(replicationSql('127.0.0.1'),/pg_hba.conf rejects replication connection/u);check('hba-rejects-tcp-physical-replication');
 rejected(replicationSql('/var/run/postgresql','postgres'),/pg_hba.conf rejects replication connection/u);check('hba-rejects-unix-physical-replication-even-maintenance-os-user');
 assert.equal(maintenanceQuery('SELECT current_user'),'postgres');check('exact-os-postgres-maintenance-channel');
 const read=spawnSync('docker',['exec','-e','PGPASSWORD=fixture-only-reader',container,'psql','-X','-h','127.0.0.1','-U','jiangkong_backup_reader','-d','postgres','-Atc','SELECT current_user'],{encoding:'utf8'});assert.equal(read.status,0,read.stderr);assert.equal(read.stdout.trim(),'jiangkong_backup_reader');check('exact-readonly-backup-connection-exception');
 assert.equal(maintenanceQuery("SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL"),'0');check('actual-hba-rules-have-no-parse-errors');
 const allowed=maintenanceQuery("SELECT count(*) FROM pg_stat_activity WHERE datname='postgres' AND pid<>pg_backend_pid()");
 assert.equal(allowed,'0');check('other-actual-database-sessions-drained');
 // Even after role regrant, the physically held connection paths stay rejected.
 assert.equal(maintenanceQuery('ALTER ROLE '+role+' LOGIN'),'ALTER ROLE');
 rejected(sql('SELECT 1',role),/pg_hba.conf rejects connection/u);check('role-login-regrant-cannot-bypass-held-tcp');
 const runtimePrepared=spawnSync('python3',['-B','-c',`import importlib.util,sys
s=importlib.util.spec_from_file_location('hold',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
sys.stdout.buffer.write(m.hold_bytes(sys.stdin.buffer.read(),'postgres',runtime='local_fixture_writer'))`,script],{input:before.stdout,encoding:'utf8'});
 assert.equal(runtimePrepared.status,0,runtimePrepared.stderr);
 maintenanceQuery("ALTER ROLE local_fixture_writer PASSWORD 'fixture-only-runtime'");
 okay(['exec','-i',container,'tee',hbaPath],runtimePrepared.stdout);assert.equal(maintenanceQuery('SELECT pg_reload_conf()'),'t');await new Promise(r=>setTimeout(r,100));
 const runtimeRead=spawnSync('docker',['exec','-e','PGPASSWORD=fixture-only-runtime',container,'psql','-X','-h','127.0.0.1','-U',role,'-d','postgres','-Atc','SELECT current_user'],{encoding:'utf8'});assert.equal(runtimeRead.status,0,runtimeRead.stderr);assert.equal(runtimeRead.stdout.trim(),role);check('exact-runtime-preview-connection-exception');
 rejected(sql('SELECT 1'),/pg_hba.conf rejects connection/u);rejected(replicationSql('127.0.0.1'),/pg_hba.conf rejects replication connection/u);check('runtime-preview-keeps-owner-tcp-and-replication-held');
 okay(['exec','-i',container,'tee',hbaPath],held);assert.equal(maintenanceQuery('SELECT pg_reload_conf()'),'t');await new Promise(r=>setTimeout(r,100));rejected(sql('SELECT 1',role),/pg_hba.conf rejects connection/u);check('ending-runtime-preview-restores-connection-hold');
 const current=run(['exec',container,'cat',hbaPath]);assert.equal(current.status,0,current.stderr);
 assert.equal(digest(current.stdout),digest(held),'exact owned HBA after digest required for rollback');
 okay(['exec','-i',container,'tee',hbaPath],before.stdout);
 assert.equal(maintenanceQuery('SELECT pg_reload_conf()'),'t');await new Promise(r=>setTimeout(r,100));
 assert.equal(sql('SELECT current_user',role).stdout.trim(),role);assert.equal(sql('SELECT current_user').stdout.trim(),'postgres');
 const restored=run(['exec',container,'cat',hbaPath]);assert.equal(restored.status,0,restored.stderr);assert.equal(digest(restored.stdout),digest(before.stdout));
 state.hbaBeforeSha256=digest(before.stdout);state.hbaHeldSha256=digest(held);
 check('exact-local-hba-byte-and-connection-rollback');
 assert.equal(replicationSql('127.0.0.1').status,0);assert.equal(replicationSql('/var/run/postgresql','postgres').status,0);check('exact-local-replication-connection-rollback');
 check('root-and-os-postgres-remain-owner-approved-maintenance-authority');
 query('DROP ROLE '+role);query('DROP ROLE jiangkong_backup_reader');
 state.status='passed';
}catch(error){state.status='failed';state.error=String(error.message).slice(0,1500);process.exitCode=1;}
finally{
 try{for(const id of [container,keeper].filter(Boolean)){const meta=JSON.parse(okay(['inspect',id]))[0];assert(meta.Id===id&&meta.Config.Labels['jgzg.pol25a.writer-hold']===runId,'owned cleanup identity');okay(['rm','-f',id]);}state.cleanup='passed';}catch(error){state.cleanup='failed';state.status='failed';state.cleanupError=String(error.message).slice(0,1000);process.exitCode=1;}
 if(client&&client.exitCode===null)client.kill();state.finishedAt=new Date().toISOString();save();
}
