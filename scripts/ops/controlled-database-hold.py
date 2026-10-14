#!/usr/bin/env python3
"""PG16 connection fence for the owner-approved maintenance window.

Capture/hold/observe are distinct bounded operations. No migration, role grant,
backup, restore, business query or automatic unfreeze. Root/postgres remains a
trusted maintenance authority, not an independently constrained witness.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('window', Path(__file__).with_name('controlled-maintenance-window.py'))
w = importlib.util.module_from_spec(spec); exec(compile(Path(spec.origin).read_bytes(),spec.origin,'exec'),w.__dict__)
HBA = '/etc/postgresql/16/main/pg_hba.conf'
READER = 'jiangkong_backup_reader'

def peer_query_argv(database='postgres'):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}',database):raise ValueError('unsafe query database')
    return ['runuser','-u','postgres','--','/usr/bin/psql','-X','-q','-t','-A','-p','5432','-d',database,'--set=ON_ERROR_STOP=1']

def assert_backup_capability(query, identity, role_sql):
    query('SET LOCAL ROLE '+READER+'; '+role_sql+'; RESET ROLE',decode=False,database=identity['database'])

def hold_bytes(before, database, reader=READER, runtime=None, backup_enabled=True):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', database) or not re.fullmatch(r'[a-z_][a-z0-9_]{1,62}', reader): raise ValueError('unsafe HBA identity')
    if b'controlled-first-launch' in before: raise ValueError('existing fence not reused')
    if not backup_enabled and runtime:raise ValueError('bootstrap cannot enable application connections')
    # Physical replication is not matched by an ordinary `all` database rule.
    prefix = ('# controlled-first-launch\nlocal replication all reject\n'
              'host replication all 0.0.0.0/0 reject\nhost replication all ::/0 reject\n'
              'local all postgres peer\n'
              f'host "{database}" {reader} 127.0.0.1/32 scram-sha-256\n'
              f'host "{database}" {reader} ::1/128 scram-sha-256\n'
              'local all all reject\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n')
    if runtime:
        if not re.fullmatch(r'[a-z_][a-z0-9_]{1,62}',runtime) or runtime in (reader,'postgres'):raise ValueError('unsafe runtime identity')
        extra=f'host "{database}" {runtime} 127.0.0.1/32 scram-sha-256\nhost "{database}" {runtime} ::1/128 scram-sha-256\n'
        prefix=prefix.replace('local all all reject\n',extra+'local all all reject\n')
    if not backup_enabled:
        prefix=prefix.replace(f'host "{database}" {reader} 127.0.0.1/32 scram-sha-256\n','').replace(f'host "{database}" {reader} ::1/128 scram-sha-256\n','')
    return prefix.encode()+before

def no_writers(snapshot):
    if snapshot['preparedTransactions'] != 0 or snapshot['subscriptions'] != 0 or snapshot['sessions'] != []:
        raise ValueError('existing write sources not drained')

def identity_sql(expected):
    if not re.fullmatch(r'[a-f0-9]{64}',expected):raise ValueError('invalid database identity')
    return "SELECT json_build_object('database',datname,'version',current_setting('server_version_num')::int,'hba',current_setting('hba_file'),'foreignDatabases',(SELECT count(*) FROM pg_database d WHERE NOT d.datistemplate AND d.datname<>target.datname AND d.datname<>'postgres' AND NOT starts_with(d.datname,'jiangkong_restore_'))) FROM pg_database target CROSS JOIN pg_control_system() WHERE encode(sha256(convert_to(system_identifier::text||'|'||datname||'|public','UTF8')),'hex')='"+expected+"'"

def main():
    operation, plan_path, pin, *extra = sys.argv[1:]
    if os.getuid() != 0 or operation not in ('capture','hold','observe','restore-connections','allow-runtime','end-runtime','capture-bootstrap','hold-bootstrap','observe-bootstrap','restore-bootstrap-connections','enable-reader') or not re.fullmatch(r'[a-f0-9]{64}',pin): raise ValueError('invalid operation')
    restoring=operation in ('restore-connections','restore-bootstrap-connections')
    if (restoring and (len(extra)!=1 or not re.fullmatch(r'[a-f0-9]{64}',extra[0]))) or (not restoring and extra):raise ValueError('invalid rollback arguments')
    raw=w.private_file(plan_path)
    confirmation=operation+':'+pin+(':'+extra[0] if extra else '')
    if w.digest(raw)!=pin or os.environ.get('CONTROLLED_DATABASE_CONFIRM')!=confirmation: raise ValueError('exact approval required')
    plan=json.loads(raw)
    if set(plan)!={'candidateSha','runId','machineIdentitySha256','databaseIdentitySha256','osPlanPath','osPlanSha256'}: raise ValueError('invalid plan')
    if not re.fullmatch(r'[a-f0-9]{40}',plan['candidateSha']) or not re.fullmatch(r'[a-z0-9-]{1,60}',plan['runId']) or not all(re.fullmatch(r'[a-f0-9]{64}',plan[k])for k in ('machineIdentitySha256','databaseIdentitySha256','osPlanSha256')):raise ValueError('invalid pins')
    if w.digest(Path('/etc/machine-id').read_bytes().strip())!=plan['machineIdentitySha256']:raise ValueError('machine mismatch')
    api_bytes=w.private_file('/etc/jiangkong/api.env');w.assert_all_frozen(api_bytes)
    runtime_roles=re.findall(r'^OPERATING_LEDGER_RUNTIME_ROLE=(?:"([a-z_][a-z0-9_]*)"|\'([a-z_][a-z0-9_]*)\'|([a-z_][a-z0-9_]*))$',api_bytes.decode(),re.M)
    if len(runtime_roles)!=1:raise ValueError('runtime identity ambiguous')
    runtime=next(x for x in runtime_roles[0] if x)
    started=time.monotonic()
    def run(argv,payload=None,extra_env=None):
        remaining=120-(time.monotonic()-started)
        if remaining<=0:raise ValueError('stage timeout')
        env={k:v for k,v in os.environ.items() if not k.startswith('PG') and 'DATABASE_URL' not in k}
        if extra_env:env.update(extra_env)
        r=subprocess.run(argv,input=payload,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(remaining,15),env=env,check=False)
        if r.returncode or len(r.stdout)>262144:raise ValueError('command stopped')
        return r.stdout
    os_raw=w.private_file(plan['osPlanPath'])
    if w.digest(os_raw)!=plan['osPlanSha256'] or any(json.loads(os_raw).get(k)!=plan[k] for k in ('candidateSha','runId','machineIdentitySha256')):raise ValueError('OS hold lineage mismatch')
    run([sys.executable,'-I','-B',str(Path(__file__).with_name('controlled-maintenance-window.py')),'observe',plan['osPlanPath'],plan['osPlanSha256']],extra_env={'CONTROLLED_WINDOW_CONFIRM':'observe:'+plan['osPlanSha256']})
    def query(sql, decode=True, database='postgres'):
        payload="BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'; "+sql+"; COMMIT;"
        result=run(peer_query_argv(database),payload.encode())
        return json.loads(result) if decode else None
    identity=query(identity_sql(plan['databaseIdentitySha256']))
    if not identity or not 160000<=identity['version']<170000 or identity['hba']!=HBA or identity['foreignDatabases']!=0:raise ValueError('database target or cluster scope mismatch')
    # Reuse the existing strict whole-database read-role contract in every
    # stage. No ownership, write capability or role-switch loophole is allowed.
    bootstrap=operation in ('capture-bootstrap','hold-bootstrap','observe-bootstrap','restore-bootstrap-connections')
    if bootstrap:
        if operation!='observe-bootstrap':
            absent=query("SELECT json_build_object('absent',count(*)=0) FROM pg_roles WHERE rolname='"+READER+"'")
            if not absent['absent']:raise ValueError('bootstrap requires absent backup identity')
    else:
        role_sql=Path(__file__).with_name('db-backup-read-role.sql').read_text()
        assert_backup_capability(query,identity,role_sql)
        if operation=='enable-reader':
            ready=query("SELECT json_build_object('ready',count(*)=1) FROM pg_roles WHERE rolname='"+READER+"' AND rolcanlogin")
            if not ready['ready']:raise ValueError('configured login identity required')
    db=identity['database']; parent=Path('/var/lib/jiangkong-controlled-launch')
    if parent.resolve()!=parent or parent.stat().st_mode&0o077:raise ValueError('unsafe snapshot parent')
    state=parent/(plan['runId']+'-database')
    file=state/'journal.json'
    hba_meta=os.lstat(HBA)
    if not stat.S_ISREG(hba_meta.st_mode) or hba_meta.st_nlink!=1 or hba_meta.st_mode&0o022:raise ValueError('unsafe HBA file')
    def save(data):w.atomic_write(file,json.dumps(data,sort_keys=True,indent=2).encode()+b'\n')
    runtime_allowed=False
    def inspect():
        exception=" OR (usename='"+runtime+"' AND client_addr IN ('127.0.0.1'::inet,'::1'::inet))" if runtime_allowed else ''
        # OS postgres peer is the approved recovery/migration channel. The
        # application UID cannot authenticate as this operating-system user.
        return query("SELECT json_build_object('preparedTransactions',(SELECT count(*) FROM pg_prepared_xacts),'subscriptions',(SELECT count(*) FROM pg_subscription WHERE subenabled),'sessions',(SELECT coalesce(json_agg(json_build_object('pid',pid,'start',backend_start,'kind',backend_type)),'[]'::json) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type IN ('client backend','walsender') AND NOT (usename='"+READER+"' OR (usename='postgres' AND client_addr IS NULL)"+exception+")))")
    if operation in ('capture','capture-bootstrap'):
        snapshot=inspect()
        if snapshot['preparedTransactions'] or snapshot['subscriptions']:raise ValueError('prepared or subscribed source requires explicit resolution')
        # The read identity must already be installed and pass full backup-role
        # preflight in the preceding approved phase; this tool never grants it.
        if not bootstrap:
            role=query("SELECT json_build_object('valid',count(*)=1) FROM pg_roles WHERE rolname='"+READER+"' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND rolcanlogin")
            if not role['valid']:raise ValueError('backup identity is not ready')
        before=w.read_regular(HBA)[0];after=hold_bytes(before,db,backup_enabled=not bootstrap)
        state.mkdir(mode=0o700)
        save({'planSha256':pin,'beforeHex':before.hex(),'beforeSha256':w.digest(before),'afterHex':after.hex(),'afterSha256':w.digest(after),'metadata':{'uid':hba_meta.st_uid,'gid':hba_meta.st_gid,'mode':stat.S_IMODE(hba_meta.st_mode)},'state':'captured','database':db,'bootstrap':bootstrap})
    else:
        journal_bytes,journal_identity=w.read_regular(file,private=True)
        if restoring and w.digest(journal_bytes)!=extra[0]:raise ValueError('rollback journal digest mismatch')
        journal=json.loads(journal_bytes)
        if journal['planSha256']!=pin or journal['database']!=db:raise ValueError('journal identity changed')
        original=bytes.fromhex(journal['beforeHex']);held=bytes.fromhex(journal['afterHex'])
        preview=journal.get('state')=='runtime-allowed';runtime_allowed=preview
        journal_bootstrap=journal.get('bootstrap',False)
        if not isinstance(journal_bootstrap,bool) or (bootstrap and not journal_bootstrap) or (operation=='enable-reader' and not journal_bootstrap) or (not bootstrap and journal_bootstrap and operation!='enable-reader'):raise ValueError('bootstrap phase mismatch')
        if w.digest(original)!=journal['beforeSha256'] or w.digest(held)!=journal['afterSha256'] or held!=hold_bytes(original,db,runtime=runtime if preview else None,backup_enabled=not journal_bootstrap):raise ValueError('journal fence not derived from original snapshot')
        if operation in ('hold','hold-bootstrap'):
            if journal['state']!='captured' or w.digest(w.read_regular(HBA)[0])!=journal['beforeSha256']:raise ValueError('before snapshot drift')
            after=bytes.fromhex(journal['afterHex'])
            if w.digest(after)!=journal['afterSha256']:raise ValueError('invalid after snapshot')
            journal['state']='holding';save(journal)
            meta=journal['metadata'];w.atomic_write(HBA,after,meta['mode'],meta['uid'],meta['gid'])
            if not query("SELECT to_json(pg_reload_conf())"):raise ValueError('reload rejected')
            # A successful reload request is asynchronous. Wait for actual
            # authentication rules to load before draining any existing client.
            deadline=time.monotonic()+20
            while True:
                loaded=query("SELECT json_build_object('load',pg_conf_load_time() >= now()-interval '5 seconds','errors',(SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL))")
                if loaded['errors']:raise ValueError('HBA parse error')
                if loaded['load']:break
                if time.monotonic()>deadline:raise ValueError('HBA reload not observed')
                time.sleep(0.2)
            env={k:v for k,v in os.environ.items() if not k.startswith('PG') and 'DATABASE_URL' not in k}
            for target in (db,'replication=true'):
                probe=subprocess.run(['/usr/bin/psql','-X','--no-password','-h','127.0.0.1','-p','5432','-U','postgres','-d',target,'-c','SELECT 1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=5)
                if probe.returncode==0 or b'pg_hba.conf rejects' not in probe.stderr:raise ValueError('live HBA rejection not proved')
            snapshot=inspect()
            if snapshot['preparedTransactions'] or snapshot['subscriptions'] or len(snapshot['sessions'])>32:raise ValueError('drain scope exceeds approval')
            if snapshot['sessions']:
                # Only the captured exact PID+start pairs; never terminate an
                # unrelated reused PID. One request, no retry or escalation.
                clauses=[]
                for s in snapshot['sessions']:
                    start=s['start'].replace("'","''");clauses.append(f"(pid={int(s['pid'])} AND backend_start='{start}'::timestamptz)")
                drained=query("SELECT coalesce(json_agg(pg_terminate_backend(pid,5000)),'[]'::json) FROM pg_stat_activity WHERE "+' OR '.join(clauses))
                if not all(drained):raise ValueError('drain incomplete')
            no_writers(inspect());journal['state']='connections-held';save(journal)
        if w.digest(w.read_regular(HBA)[0])!=journal['afterSha256'] or journal['state'] not in ('connections-held','runtime-allowed'):raise ValueError('held file or state drift')
        no_writers(inspect())
        if operation=='enable-reader':
            replacement=hold_bytes(original,db)
            journal['state']='enabling-validated-reader';save(journal)
            meta=journal['metadata'];w.atomic_write(HBA,replacement,meta['mode'],meta['uid'],meta['gid'])
            if not query("SELECT to_json(pg_reload_conf())"):raise ValueError('reader allowance reload failed')
            if query("SELECT count(*)::int FROM pg_hba_file_rules WHERE error IS NOT NULL")!=0:raise ValueError('reader allowance HBA invalid')
            journal['afterHex']=replacement.hex();journal['afterSha256']=w.digest(replacement);journal['bootstrap']=False;journal['state']='connections-held';save(journal)
            no_writers(inspect())
        if operation in ('allow-runtime','end-runtime'):
            if (operation=='allow-runtime' and preview) or (operation=='end-runtime' and not preview):raise ValueError('runtime transition mismatch')
            if run(['systemctl','show','jiangkong-api.service','--property=ActiveState','--value']).strip()!=b'inactive':raise ValueError('API must be stopped for runtime connection transition')
            replacement=hold_bytes(original,db,runtime=runtime if operation=='allow-runtime' else None)
            journal['state']='changing-runtime-allowance';save(journal)
            meta=journal['metadata'];w.atomic_write(HBA,replacement,meta['mode'],meta['uid'],meta['gid'])
            if not query("SELECT to_json(pg_reload_conf())"):raise ValueError('runtime allowance reload failed')
            journal['afterHex']=replacement.hex();journal['afterSha256']=w.digest(replacement);journal['state']='runtime-allowed' if operation=='allow-runtime' else 'connections-held';save(journal)
            runtime_allowed=operation=='allow-runtime'
            no_writers(inspect())
        if restoring:
            if preview:raise ValueError('end runtime allowance before restoring original connections')
            current,current_identity=w.read_regular(file,private=True)
            if current!=journal_bytes or current_identity!=journal_identity:raise ValueError('rollback journal changed')
            before=bytes.fromhex(journal['beforeHex'])
            if w.digest(before)!=journal['beforeSha256']:raise ValueError('rollback before snapshot changed')
            journal['state']='restoring-connections';save(journal)
            meta=journal['metadata'];w.atomic_write(HBA,before,meta['mode'],meta['uid'],meta['gid'])
            if not query("SELECT to_json(pg_reload_conf())"):raise ValueError('rollback reload rejected')
            if w.digest(w.read_regular(HBA)[0])!=journal['beforeSha256']:raise ValueError('rollback file mismatch')
            journal['state']='original-connections-restored';save(journal)
    print(json.dumps({'operation':operation,'status':'completed','cosFreezeVerified':False,'runtimeStarted':False,'originalConnectionsMayResume':restoring}))

if __name__=='__main__':
    try:main()
    except Exception:
        print('Controlled database hold stopped; retain HBA snapshot and partial hold. No retry or automatic unfreeze.',file=sys.stderr);sys.exit(1)
