#!/usr/bin/env python3
"""Read only the remaining first-launch parameters; intended for SSH stdin.
Never reads business rows, credentials or object contents; no local/remote writes.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import time

MACHINE='f909d7eaa061e2fe304778b77da1e767585fef7218d36493796efa9bfa8bb916'
DATABASE='90e196a0abec5871d16acf38c54f4a496f749b498aaa53dbccd21c0cd75fdeb9'
UNITS=('jiangkong-api.service','jiangkong-draft-retention.service','jiangkong-draft-retention.timer','jiangkong-pristine-draft-deletion-receipt-purge.service','jiangkong-pristine-draft-deletion-receipt-purge.timer')
CRON={'/var/spool/cron/crontabs/root':['028f8808dd969d9e84b28553acf56642587faad5c0355490ae89b4172d89d893'],
      '/etc/cron.d/jiangkong-offsite-db-backup':['c1c12457ac3fe3da993b2fb245419219111ae796151db162542bf1fe7032277f','bceba5ddf398a66752a14fcb703f55a376343226f84864a7038f4a508dd374aa']}
PHASE='not-started'
OBSERVATIONS={}
CONFIG_PATHS=('/etc/jiangkong/db-backup-database.env','/etc/jiangkong/db-backup.env')
def phase(value):
    global PHASE
    PHASE=value

def backup_entry_path(command):
    prefix=[]
    for token in shlex.split(command):
        if token in ('|','&&',';') or re.match(r'^\d*(?:>>?|<|>&)',token):break
        prefix.append(token)
    # A lock/log path is an argument, not an executable. Only a script with a
    # recognized extension and backup name may become an approved entry file.
    candidates=[x for x in prefix if x.startswith('/') and 'backup' in Path(x).name and (Path(x).suffix in ('.sh','.py','.mjs','.cjs') or x=='/usr/local/bin/jiangkong-backup') and re.fullmatch(r'/[A-Za-z0-9_./-]+',x) and '..' not in Path(x).parts]
    if len(candidates)!=1:raise ValueError('backup executable path ambiguous')
    executable=candidates[0]
    if not executable.startswith(('/opt/jiangkong/','/usr/local/sbin/','/usr/local/bin/','/home/ubuntu/','/usr/local/lib/jiangkong-offsite-backup/')):raise ValueError('unexpected executable root')
    return executable

def digest(raw):return hashlib.sha256(raw).hexdigest()
def read(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_mode&0o022 or s.st_size>262144:raise ValueError('unsafe parameter file')
        raw=os.read(fd,262145)
        identity=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mtime_ns,x.st_ctime_ns,x.st_uid,x.st_mode)
        if len(raw)!=s.st_size or identity(s)!=identity(os.fstat(fd)) or identity(s)!=identity(os.lstat(path)):raise ValueError('parameter file changed')
        return raw,{'path':path,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'sha256':digest(raw)}
    finally:os.close(fd)

def main():
    global OBSERVATIONS
    OBSERVATIONS={}
    phase('machine-identity')
    if os.getuid()!=0:raise ValueError('root required')
    if digest(read('/etc/machine-id')[0].strip())!=MACHINE:raise ValueError('machine mismatch')
    started=time.monotonic()
    def command(argv,payload=None):
        remain=60-(time.monotonic()-started)
        if remain<=0:raise ValueError('preflight deadline')
        env={k:v for k,v in os.environ.items() if not k.startswith('PG') and not re.search('PASSWORD|SECRET|TOKEN|DATABASE_URL',k)}
        r=subprocess.run(argv,input=payload,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=min(remain,15),env=env,check=False)
        if r.returncode or len(r.stdout)>262144:raise ValueError('readonly command stopped')
        return r.stdout
    def query(sql,database="postgres"):
        raw=command(['runuser','-u','postgres','--','/usr/bin/psql','-X','-q','-t','-A','-p','5432','-d',database,'--set=ON_ERROR_STOP=1'],("BEGIN READ ONLY; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'; "+sql+"; COMMIT;").encode())
        return json.loads(raw)
    phase('database-identity')
    target=query("SELECT json_build_object('database',datname,'version',current_setting('server_version_num')::int,'hba',current_setting('hba_file')) FROM pg_database CROSS JOIN pg_control_system() WHERE encode(sha256(convert_to(system_identifier::text||'|'||datname||'|public','UTF8')),'hex')='"+DATABASE+"'")
    if not target or not 160000<=target['version']<170000 or target['hba']!='/etc/postgresql/16/main/pg_hba.conf':raise ValueError('database mismatch')
    OBSERVATIONS.update({'machineIdentitySha256':MACHINE,'databaseIdentitySha256':DATABASE,'target':target})
    # Only role/ACL/owner/default-privilege metadata, never pg_authid/passwords.
    phase('database-permission-metadata')
    permissions=query("SELECT json_build_object('backupRole',(SELECT row_to_json(r) FROM (SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='jiangkong_backup_reader') r),'helper',(SELECT row_to_json(f) FROM (SELECT pg_get_userbyid(proowner) AS owner,proacl::text AS acl,encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex') AS definitionSha256 FROM pg_proc WHERE oid=to_regprocedure('public.assert_fund_movement_write_context()')) f),'defaultPrivileges',(SELECT coalesce(json_agg(json_build_object('owner',pg_get_userbyid(defaclrole),'namespace',defaclnamespace,'type',defaclobjtype,'acl',defaclacl::text)),'[]'::json) FROM pg_default_acl),'creators',(SELECT json_agg(DISTINCT pg_get_userbyid(relowner)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S')))",target['database'])
    OBSERVATIONS['permissions']=permissions
    phase('migration-metadata')
    migrations=query("SELECT coalesce(json_agg(json_build_object('name',migration_name,'checksum',checksum,'finishedAt',finished_at,'rolledBackAt',rolled_back_at) ORDER BY migration_name),'[]'::json) FROM public.\"_prisma_migrations\"",target['database'])
    OBSERVATIONS['migrations']=migrations
    phase('hba-metadata')
    hba_stat=os.lstat(target['hba'])
    if not stat.S_ISREG(hba_stat.st_mode) or hba_stat.st_nlink!=1 or hba_stat.st_mode&0o022:raise ValueError('unsafe HBA metadata')
    hba_meta={'path':target['hba'],'uid':hba_stat.st_uid,'gid':hba_stat.st_gid,'mode':stat.S_IMODE(hba_stat.st_mode),'size':hba_stat.st_size}
    OBSERVATIONS['hba']={'metadata':hba_meta}
    units={}
    phase('five-service-control-metadata')
    for unit in UNITS:
        properties='Id,ActiveState,FragmentPath,DropInPaths,User,Group,KillMode,TimeoutStopUSec,WorkingDirectory,ExecStart'
        values=dict(x.split('=',1)for x in command(['systemctl','show',unit,'--property='+properties]).decode().splitlines()if '=' in x)
        exec_value=values.pop('ExecStart','')
        if re.search(r'(?i)((?:password|secret|token|credential)[=:]|postgresql?://|--credential)',exec_value):raise ValueError('sensitive unit command refused')
        values['execStartSha256']=digest(exec_value.encode())
        program=re.search(r'path=([^;\s}]+)',exec_value)
        values['executablePath']=program.group(1) if program else None
        values['entrypoints']=re.findall(r'/(?:opt/jiangkong|srv/jiangkong)/[A-Za-z0-9_./-]+\.(?:js|cjs|mjs)',exec_value)
        units[unit]=values
    OBSERVATIONS['units']=units
    configs=[]
    phase('two-configuration-file-metadata')
    # Existence and ownership only. No environment body or credential digest.
    for path in CONFIG_PATHS:
        try:s=os.lstat(path)
        except FileNotFoundError:configs.append({'path':path,'exists':False});continue
        if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=0 or s.st_mode&0o077:raise ValueError('unsafe private configuration metadata')
        configs.append({'path':path,'exists':True,'uid':s.st_uid,'mode':stat.S_IMODE(s.st_mode)})
    OBSERVATIONS['configurationPresence']=configs
    crons=[];scripts=set()
    phase('three-cron-bindings')
    for path,pins in CRON.items():
        raw,meta=read(path);matches=[]
        for line in raw.decode().splitlines():
            if not line.strip() or line.lstrip().startswith('#'):continue
            parts=line.split(None,5 if path.endswith('/root') else 6)
            if len(parts)!=(6 if path.endswith('/root') else 7):continue
            pin=digest(parts[-1].encode())
            if pin not in pins:continue
            if not path.endswith('/root') and parts[5]!='root':raise ValueError('cron executor mismatch')
            executable=backup_entry_path(parts[-1])
            scripts.add(executable);matches.append({'commandSha256':pin,'schedule':parts[:5],'executable':executable})
        if sorted(x['commandSha256'] for x in matches)!=sorted(pins):raise ValueError('cron bindings changed')
        crons.append({'file':meta,'entries':matches})
    OBSERVATIONS['cronBindings']=crons
    installs=[]
    phase('backup-entry-file-metadata')
    for path in sorted(scripts):
        _,meta=read(path);installs.append(meta)
    OBSERVATIONS['backupExecutables']=installs
    print(json.dumps({'status':'completed-readonly-gaps','machineIdentitySha256':MACHINE,'databaseIdentitySha256':DATABASE,'target':target,'hba':{'metadata':hba_meta},'cronBindings':crons,'backupExecutables':installs,'units':units,'permissions':permissions,'migrations':migrations,'configurationPresence':configs,'productionMutation':False,'businessRowsRead':False,'verifiedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}))

def run_once():
    try:main()
    except Exception as error:
        # No exception message, stderr, paths or remote data are included.
        category='timeout' if isinstance(error,subprocess.TimeoutExpired) else 'file-access' if isinstance(error,OSError) else 'json-contract' if isinstance(error,json.JSONDecodeError) else 'precondition-or-command'
        reasons={'backup executable path ambiguous':'entry-ambiguous','unexpected executable root':'entry-root-refused','cron bindings changed':'cron-binding-mismatch','cron executor mismatch':'cron-executor-mismatch'}
        reason=reasons.get(str(error),'not-classified')
        print(json.dumps({'status':'stopped-readonly-gaps','phase':PHASE,'errorCategory':category,'reasonCode':reason,'partialObservations':OBSERVATIONS,'productionMutation':False,'businessRowsRead':False}));return 1
    return 0

if __name__=='__main__':sys.exit(run_once())
