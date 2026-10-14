#!/usr/bin/env python3
"""Switch two existing maintenance task entry paths while the OS hold remains.
No service starts, database access, permission grants or business unfreeze.
"""
import hashlib,json,os,re,stat,subprocess,sys,time
from pathlib import Path
import types
w=types.ModuleType('window');exec(compile(Path(__file__).with_name('controlled-maintenance-window.py').read_bytes(),'controlled-maintenance-window.py','exec'),w.__dict__)
TASKS={'jiangkong-draft-retention.service':('execute-contract-draft-retention.cjs','--timer-approved-temporary'),'jiangkong-pristine-draft-deletion-receipt-purge.service':('purge-pristine-draft-deletion-receipts.cjs','--timer-approved-receipt-purge')}
def digest(b):return hashlib.sha256(b).hexdigest()
def valid_ids(sha,run):
    if not re.fullmatch(r'[a-f0-9]{40}',sha) or not re.fullmatch(r'[a-z0-9-]{1,60}',run):raise ValueError('invalid version or run')
def content(unit,sha,run):
    valid_ids(sha,run);script,flag=TASKS[unit]
    return (f'# controlled-first-launch {sha} {run}\n[Service]\nWorkingDirectory=/srv/jiangkong/apps/api\nExecStart=\nExecStart=/usr/bin/node /srv/jiangkong/apps/api/scripts/{script} {flag}\nReadOnlyPaths=/srv/jiangkong/apps/api\n').encode()
def drop_in(raw,unit,sha,run):
    script,flag=TASKS[unit];text=raw.decode()
    if re.findall(r'^User=(.*)$',text,re.M)!=['ubuntu'] or re.findall(r'^WorkingDirectory=(.*)$',text,re.M)!=['/opt/jiangkong/services/api']:raise ValueError('original task identity changed')
    if re.findall(r'^ExecStart=(.*)$',text,re.M)!=[f'/usr/bin/node /opt/jiangkong/services/api/scripts/{script} {flag}']:raise ValueError('original task command changed')
    return content(unit,sha,run)
def target(unit):return Path('/etc/systemd/system')/(unit+'.d')/'80-jiangkong-controlled-runtime.conf'
def assert_effective(unit,value,root):
    script,flag=TASKS[unit]
    if re.findall(r'argv\[\]=(.*?)(?: ;|;)',value)!=[f'/usr/bin/node {root}/scripts/{script} {flag}']:raise ValueError('effective task arguments changed')
def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def directory_pin(path,owner_uid=0):
    path=Path(path);s=path.lstat()
    if path.resolve()!=path or not stat.S_ISDIR(s.st_mode) or s.st_uid!=owner_uid or s.st_mode&0o022:raise ValueError('unsafe drop-in directory')
    return [s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode)]
def file_pin(meta):
    return {**meta,'identity':list(meta['identity'])}
def created_file_matches(path,expected_hash,expected_meta):
    body,meta=w.read_regular(path)
    if file_pin(meta)!=expected_meta or digest(body)!=expected_hash:raise ValueError('installed file identity changed')
    return meta
def create_drop_in(path,body,owner_uid=0,create_parent=False):
    path=Path(path)
    if create_parent:
        directory_pin(path.parent.parent,owner_uid);path.parent.mkdir(mode=0o755);sync_directory(path.parent.parent)
    directory_pin(path.parent,owner_uid)
    fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    try:
        os.fchmod(fd,0o644)
        with os.fdopen(os.dup(fd),'wb')as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
        pin=w.fingerprint(os.fstat(fd));saved,meta=w.read_regular(path)
        if saved!=body or meta['uid']!=owner_uid or meta['identity']!=pin or w.fingerprint(os.fstat(fd))!=pin:raise ValueError('drop-in save changed')
    finally:os.close(fd)
    sync_directory(path.parent);return file_pin(meta)
def remove_drop_in(path,expected_hash,expected_meta):
    body,meta=w.read_regular(path)
    if file_pin(meta)!=expected_meta or digest(body)!=expected_hash:raise ValueError('owned drop-in changed before withdrawal')
    os.unlink(path);sync_directory(Path(path).parent)
def validate_journal(j):
    if set(j)!={'candidateSha','runId','planSha256','state','files'}:raise ValueError('invalid journal')
    valid_ids(j['candidateSha'],j['runId'])
    if not re.fullmatch(r'[a-f0-9]{64}',j['planSha256']) or j['state'] not in ('prepared','installed','restored'):raise ValueError('invalid journal state')
    if len(j['files'])!=2 or {r['unit']for r in j['files']}!=set(TASKS):raise ValueError('exact two task records required')
    for r in j['files']:
        if set(r)!={'unit','baseSha256','afterSha256','parentCreated','parentIdentity','createdIdentity'} or not re.fullmatch(r'[a-f0-9]{64}',r['baseSha256']) or r['afterSha256']!=digest(content(r['unit'],j['candidateSha'],j['runId'])):raise ValueError('journal content not derived from fixed task scope')
        if type(r['parentCreated'])is not bool:raise ValueError('invalid directory ownership record')
        if j['state']!='prepared' and (not isinstance(r['parentIdentity'],list)or len(r['parentIdentity'])!=5 or not isinstance(r['createdIdentity'],dict)or set(r['createdIdentity'])!={'uid','gid','mode','identity'}or not isinstance(r['createdIdentity']['identity'],list)or len(r['createdIdentity']['identity'])!=9):raise ValueError('creation identity missing')
    return j

def main():
    operation,plan_path,pin,*extra=sys.argv[1:]
    if os.getuid()!=0 or operation not in ('install','restore') or not re.fullmatch(r'[a-f0-9]{64}',pin):raise ValueError('invalid root operation')
    if (operation=='restore' and (len(extra)!=1 or not re.fullmatch(r'[a-f0-9]{64}',extra[0]))) or (operation=='install' and extra):raise ValueError('invalid arguments')
    raw=w.private_file(plan_path)
    if digest(raw)!=pin or os.environ.get('CONTROLLED_TASK_CONFIRM')!=operation+':'+pin+(':'+extra[0] if extra else ''):raise ValueError('explicit exact approval required')
    plan=json.loads(raw)
    if set(plan)!={'candidateSha','runId','machineIdentitySha256','osPlanPath','osPlanSha256','units'} or set(plan['units'])!=set(TASKS):raise ValueError('invalid plan')
    valid_ids(plan['candidateSha'],plan['runId'])
    if plan['osPlanPath']!=f"/var/lib/jiangkong-controlled-launch/{plan['runId']}-os-plan.json" or not re.fullmatch(r'[a-f0-9]{64}',plan['osPlanSha256']):raise ValueError('invalid fixed hold plan path')
    if digest(w.read_regular('/etc/machine-id')[0].strip())!=plan['machineIdentitySha256']:raise ValueError('machine mismatch')
    w.assert_all_frozen(w.private_file('/etc/jiangkong/api.env'))
    os_raw=w.private_file(plan['osPlanPath']);os_plan=w.validate_plan(json.loads(os_raw))
    if digest(os_raw)!=plan['osPlanSha256'] or any(os_plan[k]!=plan[k]for k in ('candidateSha','runId','machineIdentitySha256')):raise ValueError('hold lineage mismatch')
    parent=Path('/var/lib/jiangkong-controlled-launch')
    if parent.resolve()!=parent or parent.stat().st_uid!=0 or parent.stat().st_mode&0o077:raise ValueError('unsafe journal parent')
    os_journal=w.private_file(parent/plan['runId']/'journal.json')
    if json.loads(os_journal)['state']!='os-sources-held':raise ValueError('all OS sources must remain held')
    started=time.monotonic()
    def command(argv,env=None):
        remaining=60-(time.monotonic()-started)
        if remaining<=0:raise ValueError('task wiring deadline')
        safe_env={k:v for k,v in os.environ.items()if not k.startswith('PG')and not re.search('PASSWORD|SECRET|TOKEN|DATABASE_URL',k)}
        if env:safe_env.update({k:v for k,v in env.items()if k=='CONTROLLED_WINDOW_CONFIRM'})
        r=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(remaining,15),env=safe_env,check=False)
        if r.returncode or len(r.stdout)>262144:raise ValueError('task wiring command stopped')
        return r.stdout
    command([sys.executable,'-I','-B',str(Path(__file__).with_name('controlled-maintenance-window.py')),'observe',plan['osPlanPath'],plan['osPlanSha256']],env={**os.environ,'CONTROLLED_WINDOW_CONFIRM':'observe:'+plan['osPlanSha256']})
    state=parent/(plan['runId']+'-task-wiring');journal=state/'journal.json'
    if operation=='install':
        rows=[]
        repo='/srv/jiangkong/releases/'+plan['candidateSha']
        git=['git','--no-optional-locks','-c','safe.directory='+repo,'-c','core.fsmonitor=false','-C',repo]
        if command(git+['rev-parse','HEAD']).decode().strip()!=plan['candidateSha'] or command(git+['status','--porcelain=v1']).strip():raise ValueError('candidate checkout not clean and exact')
        for unit,(script,_)in TASKS.items():
            if set(plan['units'][unit])!={'execStartSha256'} or not re.fullmatch(r'[a-f0-9]{64}',plan['units'][unit]['execStartSha256']):raise ValueError('invalid task pin')
            observed=command(['systemctl','show',unit,'--property=ExecStart']).decode().strip()
            if not observed.startswith('ExecStart=') or digest(observed[len('ExecStart='):].encode())!=plan['units'][unit]['execStartSha256']:raise ValueError('effective task command changed')
            assert_effective(unit,observed,'/opt/jiangkong/services/api')
            source=Path('/etc/systemd/system')/unit;base=w.read_regular(source)[0];after=drop_in(base,unit,plan['candidateSha'],plan['runId'])
            deployed=w.read_regular('/srv/jiangkong/apps/api/scripts/'+script)[0]
            if deployed!=command(git+['show',plan['candidateSha']+':services/api/scripts/'+script]):raise ValueError('task script does not match candidate')
            path=target(unit)
            directory_pin(path.parent.parent)
            missing=not os.path.lexists(path.parent)
            if not missing:directory_pin(path.parent)
            if os.path.lexists(path):raise ValueError('existing task drop-in')
            rows.append({'unit':unit,'baseSha256':digest(base),'afterSha256':digest(after),'parentCreated':missing,'parentIdentity':None,'createdIdentity':None})
        state.mkdir(mode=0o700)
        j=validate_journal({'candidateSha':plan['candidateSha'],'runId':plan['runId'],'planSha256':pin,'state':'prepared','files':rows})
        w.atomic_write(journal,json.dumps(j,sort_keys=True).encode()+b'\n')
        for row in rows:
            path=target(row['unit'])
            row['createdIdentity']=create_drop_in(path,content(row['unit'],plan['candidateSha'],plan['runId']),create_parent=row['parentCreated'])
            row['parentIdentity']=directory_pin(path.parent)
            w.atomic_write(journal,json.dumps(j,sort_keys=True).encode()+b'\n')
        command(['systemctl','daemon-reload']);j['state']='installed';w.atomic_write(journal,json.dumps(j,sort_keys=True).encode()+b'\n')
    else:
        journal_raw,journal_meta=w.read_regular(journal,private=True)
        if digest(journal_raw)!=extra[0]:raise ValueError('exact rollback journal required')
        j=validate_journal(json.loads(journal_raw))
        if j['planSha256']!=pin or j['candidateSha']!=plan['candidateSha'] or j['runId']!=plan['runId'] or j['state']!='installed':raise ValueError('partial or wrong installation requires inspection')
        pins={}
        for row in j['files']:
            path=target(row['unit'])
            if directory_pin(path.parent)!=row['parentIdentity']:raise ValueError('installed directory changed')
            pins[row['unit']]=created_file_matches(path,row['afterSha256'],row['createdIdentity'])
            after=w.read_regular(path)[0]
            if digest(w.read_regular(Path('/etc/systemd/system')/row['unit'])[0])!=row['baseSha256'] or digest(after)!=row['afterSha256']:raise ValueError('task base or owned drop-in drift')
        current,current_meta=w.read_regular(journal,private=True)
        if current!=journal_raw or current_meta!=journal_meta:raise ValueError('rollback journal changed')
        for row in j['files']:
            path=target(row['unit'])
            if directory_pin(path.parent)!=row['parentIdentity']:raise ValueError('directory changed before withdrawal')
            remove_drop_in(path,row['afterSha256'],row['createdIdentity'])
            if row['parentCreated'] and not any(path.parent.iterdir()):path.parent.rmdir();sync_directory(path.parent.parent)
        command(['systemctl','daemon-reload']);j['state']='restored';w.atomic_write(journal,json.dumps(j,sort_keys=True).encode()+b'\n')
    command([sys.executable,'-I','-B',str(Path(__file__).with_name('controlled-maintenance-window.py')),'observe',plan['osPlanPath'],plan['osPlanSha256']],env={**os.environ,'CONTROLLED_WINDOW_CONFIRM':'observe:'+plan['osPlanSha256']})
    expected='/srv/jiangkong/apps/api'if operation=='install'else'/opt/jiangkong/services/api'
    for unit in TASKS:
        values=dict(line.split('=',1)for line in command(['systemctl','show',unit,'--property=ExecStart,WorkingDirectory,User']).decode().splitlines()if '='in line)
        if values.get('WorkingDirectory')!=expected or values.get('User')!='ubuntu':raise ValueError('effective task environment changed')
        assert_effective(unit,values.get('ExecStart',''),expected)
    print(json.dumps({'status':j['state'],'servicesStarted':False,'businessUnfrozen':False}))
if __name__=='__main__':
    try:main()
    except Exception:print('Controlled task wiring stopped; retain journal and owned partial files.',file=sys.stderr);sys.exit(1)
