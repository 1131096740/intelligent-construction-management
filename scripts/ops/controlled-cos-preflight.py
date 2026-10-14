#!/usr/bin/env python3
"""One owner-approved read stage; seven fixed cloud requests, no remote writes."""
import datetime,hashlib,hmac,http.client,json,os,re,signal,ssl,stat,sys,time
from urllib.parse import quote
import xml.etree.ElementTree as ET
MACHINE='f909d7eaa061e2fe304778b77da1e767585fef7218d36493796efa9bfa8bb916'
BUCKET='jiangkong-prod-files-1438687719'
OWNER='100049377606'
APPLICATION='100050465776'
BACKUP_READER='100050728192'
PHASE='machine';OBSERVATIONS={};START=0;CALLS=0;FORBIDDEN=()
sha=lambda b:hashlib.sha256(b).hexdigest()
class AbsentConfiguration(Exception):
    def __init__(self,code,raw):self.code=code;self.raw=raw
def mac(key,text,algorithm='sha256'):return hmac.new(key,text.encode(),algorithm).digest()
def read_private(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        s=os.fstat(fd)
        if not stat.S_ISREG(s.st_mode)or s.st_nlink!=1 or s.st_uid!=0 or s.st_mode&0o077 or s.st_size>65536:raise ValueError('private file')
        raw=os.read(fd,65537)
        pin=lambda x:(x.st_dev,x.st_ino,x.st_size,x.st_mode,x.st_uid,x.st_mtime_ns,x.st_ctime_ns)
        if len(raw)!=s.st_size or pin(s)!=pin(os.fstat(fd))or pin(s)!=pin(os.lstat(path)):raise ValueError('file changed')
        return raw,pin(s)
    finally:os.close(fd)
def config(raw,profile='application'):
    if profile not in {'application','backup-reader'}:raise ValueError('storage identity')
    if profile=='backup-reader':
        values={};required={'DB_BACKUP_COS_BUCKET','DB_BACKUP_COS_REGION','DB_BACKUP_COS_SECRET_ID','DB_BACKUP_COS_SECRET_KEY'}
        allowed=required|{'DB_BACKUP_COS_PREFIX','DB_BACKUP_LOCAL_RETENTION_DAYS'}
        for line in raw.decode().splitlines():
            line=line.strip()
            if not line or line.startswith('#'):continue
            match=re.fullmatch(r'(?:export\s+)?([A-Z_]+)=(.*)',line)
            if not match or match[1]not in allowed or match[1]in values:raise ValueError('invalid config')
            value=match[2]
            if len(value)>=2 and value[0]==value[-1]and value[0]in "\"'":value=value[1:-1]
            if not value or any(ch in value for ch in '\x00\r\n'):raise ValueError('invalid config')
            values[match[1]]=value
        if not required.issubset(values)or values['DB_BACKUP_COS_BUCKET']!='jiangkong-prod-db-backups-1438687719'or values['DB_BACKUP_COS_REGION']!='ap-chengdu':raise ValueError('storage identity')
        # Credentials remain in memory. Explicitly selected profile reads the
        # business bucket; it does not rewrite the existing backup destination.
        return {'FILE_STORAGE_DRIVER':'cos','COS_BUCKET':BUCKET,'COS_REGION':'ap-chengdu','COS_SECRET_ID':values['DB_BACKUP_COS_SECRET_ID'],'COS_SECRET_KEY':values['DB_BACKUP_COS_SECRET_KEY']}
    values={};wanted={'FILE_STORAGE_DRIVER','COS_BUCKET','COS_REGION','COS_SECRET_ID','COS_SECRET_KEY'}
    for line in raw.decode().splitlines():
        match=re.fullmatch(r'(?:export\s+)?([A-Z_]+)=(.*)',line.strip())
        if not match or match[1]not in wanted:continue
        if match[1]in values:raise ValueError('duplicate config')
        value=match[2]
        if len(value)>=2 and value[0]==value[-1]and value[0]in "\"'":value=value[1:-1]
        if not value or '\x00'in value:raise ValueError('invalid config')
        values[match[1]]=value
    if set(values)!=wanted or values['FILE_STORAGE_DRIVER']!='cos'or values['COS_BUCKET']!=BUCKET or values['COS_REGION']!='ap-chengdu':raise ValueError('storage identity')
    return values
def request(host,method,path,headers,body=None,absent_error=None):
    global CALLS
    CALLS+=1;remaining=75-(time.monotonic()-START)
    if CALLS>7 or remaining<=0:raise ValueError('stage limit')
    connection=http.client.HTTPSConnection(host,timeout=min(10,remaining),context=ssl.create_default_context())
    try:
        connection.request(method,path,body,headers);r=connection.getresponse();raw=r.read(262145)
        request_id=r.getheader('x-cos-request-id')
        if host!='sts.tencentcloudapi.com':
            if not request_id or any(secret in request_id for secret in FORBIDDEN)or not re.fullmatch(r'[A-Za-z0-9+/=_-]{1,160}',request_id):raise ValueError('request trace missing')
            OBSERVATIONS.setdefault('responseProofs',[]).append({'phase':PHASE,'httpStatus':r.status,'requestId':request_id,'bodySha256':sha(raw)})
        if r.status!=200 or len(raw)>262144:
            code=re.search(rb'<Code>([A-Za-z.]{1,80})</Code>',raw)
            allowed={'AccessDenied','NoSuchLifecycleConfiguration','NoSuchReplicationConfiguration','NoSuchBucketPolicy','SignatureDoesNotMatch','InvalidAccessKeyId'}
            safe=code[1].decode()if code and code[1].decode()in allowed else 'unclassified'
            OBSERVATIONS['lastResponse']={'httpStatus':r.status,'errorCode':safe}
            if r.status==404 and len(raw)<=262144 and absent_error in {'NoSuchBucketPolicy','NoSuchLifecycleConfiguration','NoSuchReplicationConfiguration'} and safe==absent_error:
                # Preserve the real 404 Error body; never synthesize a 200 XML
                # configuration. Authentication/unknown errors still stop.
                raise AbsentConfiguration(safe,raw)
            raise ValueError('cloud read stopped')
        return raw
    finally:connection.close()
def unique_json(raw):
    def pairs(items):
        out={}
        for key,value in items:
            if key in out:raise ValueError('duplicate JSON field')
            out[key]=value
        return out
    return json.loads(raw,object_pairs_hook=pairs)
def protected_response(raw,c,name):
    secrets=(c['COS_SECRET_ID'],c['COS_SECRET_KEY'])
    def check(value,depth=0):
        if depth>32:raise ValueError('response nesting limit')
        if isinstance(value,str):
            if any(secret in value for secret in secrets):raise ValueError('sensitive response')
            if value.strip().startswith(('{','[','"')):
                try:nested=unique_json(value)
                except json.JSONDecodeError:nested=None
                if nested is not None:check(nested,depth+1)
        elif isinstance(value,dict):
            for key,item in value.items():
                if key.rsplit('}',1)[-1].split(':')[-1].lower()in {'secretid','secretkey','password','authorization','securitytoken','privatekey'}:raise ValueError('authentication response field')
                check(key,depth+1);check(item,depth+1)
        elif isinstance(value,list):
            for item in value:check(item,depth+1)
    if name=='policy':
        policy=unique_json(raw)
        if not isinstance(policy,dict)or policy.get('version')!='2.0'or ('Statement'in policy)==('statement'in policy)or not isinstance(policy.get('Statement',policy.get('statement')),list):raise ValueError('metadata root')
        check(policy)
    else:
        if re.search(rb'<!',raw):raise ValueError('unsupported XML')
        tree=ET.fromstring(raw)
        roots={'acl':'AccessControlPolicy','lifecycle':'LifecycleConfiguration','replication':'ReplicationConfiguration','versioning':'VersioningConfiguration','uploads':'ListMultipartUploadsResult','error':'Error'}
        if tree.tag.split('}')[-1]!=roots[name]:raise ValueError('metadata root')
        for node in tree.iter():
            if node.tag.split('}')[-1].lower()in {'secretid','secretkey','password','authorization','securitytoken','privatekey'}:raise ValueError('authentication XML field')
            check(node.tag);check(node.text or '');check(node.tail or '');check(node.attrib)
    if any(secret.encode()in raw for secret in secrets):raise ValueError('sensitive response')
def identity(c,actor=APPLICATION):
    if actor not in {APPLICATION,BACKUP_READER}:raise ValueError('caller mismatch')
    host='sts.tencentcloudapi.com';now=int(time.time());date=datetime.datetime.fromtimestamp(now,datetime.timezone.utc).strftime('%Y-%m-%d');body=b'{}'
    canonical='POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:'+host+'\n\ncontent-type;host\n'+sha(body)
    scope=date+'/sts/tc3_request';to_sign='TC3-HMAC-SHA256\n'+str(now)+'\n'+scope+'\n'+sha(canonical.encode())
    key=mac(mac(mac(('TC3'+c['COS_SECRET_KEY']).encode(),date),'sts'),'tc3_request')
    authorization='TC3-HMAC-SHA256 Credential='+c['COS_SECRET_ID']+'/'+scope+', SignedHeaders=content-type;host, Signature='+mac(key,to_sign).hex()
    raw=request(host,'POST','/',{'Host':host,'Content-Type':'application/json; charset=utf-8','X-TC-Action':'GetCallerIdentity','X-TC-Version':'2018-08-13','X-TC-Region':'ap-chengdu','X-TC-Timestamp':str(now),'Authorization':authorization},body)
    envelope=unique_json(raw)
    if not isinstance(envelope,dict)or set(envelope)!={'Response'}:raise ValueError('identity envelope')
    data=envelope['Response'];allowed={'AccountId','UserId','PrincipalId','Arn','Type','RequestId'}
    if isinstance(data,dict)and set(data)=={'Error','RequestId'}and isinstance(data['Error'],dict)and set(data['Error'])=={'Code','Message'}:
        # Tencent API errors can have HTTP 200. Discard all error text, including
        # known messages: only hard-allowlisted codes and a valid trace survive.
        error_codes={'MissingParameter','InvalidParameter','InvalidParameterValue','UnauthorizedOperation','RequestLimitExceeded','InternalError','UnsupportedRegion','AuthFailure.SignatureFailure','AuthFailure.SecretIdNotFound','AuthFailure.InvalidSecretId','AuthFailure.TokenFailure','AuthFailure.TokenExpired','AuthFailure.SecretIdNotFound','AuthFailure.SignatureExpire'}
        code=data['Error']['Code'];trace=data['RequestId']
        code=code if isinstance(code,str)and code in error_codes and not any(secret in code for secret in (c['COS_SECRET_ID'],c['COS_SECRET_KEY'])) else 'unclassified'
        trace=trace if isinstance(trace,str)and re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}',trace)and not any(secret in trace for secret in (c['COS_SECRET_ID'],c['COS_SECRET_KEY'])) else None
        OBSERVATIONS['identityDiagnostic']={'responseKind':'cloud-error','errorCode':code,'requestId':trace}
        raise ValueError('cloud identity error')
    if not isinstance(data,dict)or set(data)!=allowed:
        # Never persist unknown field names or values; either can carry secrets.
        OBSERVATIONS['identityDiagnostic']={'responseKind':'unexpected-shape','missingKnownFields':sorted(allowed-set(data))if isinstance(data,dict)else sorted(allowed),'unexpectedFieldCount':len(set(data)-allowed)if isinstance(data,dict)else None}
        raise ValueError('identity shape')
    if data['AccountId']!=OWNER or data['UserId']!=actor or data['PrincipalId']!=actor or data['Arn']!='qcs::cam:'+OWNER+':uin/'+actor or data['Type']!='CAMUser':raise ValueError('caller mismatch')
    if not isinstance(data['RequestId'],str)or not re.fullmatch(r'[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}',data['RequestId']):raise ValueError('request identity')
    return data

def cos_control(c,name,allow_absence=False):
    host=BUCKET+'.cos.ap-chengdu.myqcloud.com';now=int(time.time());key_time=str(now)+';'+str(now+600)
    query={name:''}
    if name=='uploads':query['max-uploads']='100'
    entries=sorted(query.items());parameters='&'.join(quote(k,safe='-_.~')+'='+quote(v,safe='-_.~')for k,v in entries)
    canonical='get\n/\n'+parameters+'\nhost='+quote(host,safe='-_.~')+'\n'
    to_sign='sha1\n'+key_time+'\n'+hashlib.sha1(canonical.encode()).hexdigest()+'\n'
    key=mac(c['COS_SECRET_KEY'].encode(),key_time,'sha1').hex().encode()
    auth='q-sign-algorithm=sha1&q-ak='+c['COS_SECRET_ID']+'&q-sign-time='+key_time+'&q-key-time='+key_time+'&q-header-list=host&q-url-param-list='+';'.join(k for k,v in entries)+'&q-signature='+mac(key,to_sign,'sha1').hex()
    args=(host,'GET','/?'+parameters,{'Host':host,'Authorization':auth})
    try:
        absent={'policy':'NoSuchBucketPolicy','lifecycle':'NoSuchLifecycleConfiguration','replication':'NoSuchReplicationConfiguration'}.get(name)
        raw=request(*args,absent_error=absent) if allow_absence else request(*args)
    except AbsentConfiguration as missing:
        protected_response(missing.raw,c,'error')
        tree=ET.fromstring(missing.raw);codes=[node.text for node in tree if node.tag.split('}')[-1]=='Code']
        if codes!=[absent]:raise ValueError('metadata root')
        return {'httpStatus':404,'errorCode':missing.code,'rawResponse':missing.raw.decode(),'configurationAbsent':True}
    protected_response(raw,c,name)
    return raw.decode()
def main():
    global PHASE,START,FORBIDDEN
    identity_only=sys.argv[1:]==['backup-reader','identity-only']
    profile='application' if len(sys.argv)==1 else 'backup-reader' if identity_only else sys.argv[1] if len(sys.argv)==2 else None
    if profile not in {'application','backup-reader'}:raise ValueError('storage identity')
    source='/etc/jiangkong/api.env' if profile=='application' else '/etc/jiangkong/db-backup.env'
    if os.getuid()!=0:raise ValueError('root required')
    if os.environ.get('SSLKEYLOGFILE'):raise ValueError('TLS logging forbidden')
    fd=os.open('/etc/machine-id',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        machine_meta=os.fstat(fd)
        if not stat.S_ISREG(machine_meta.st_mode)or machine_meta.st_nlink!=1 or machine_meta.st_uid!=0 or machine_meta.st_mode&0o022 or machine_meta.st_size>256:raise ValueError('machine file')
        machine=os.read(fd,256).strip()
    finally:os.close(fd)
    if sha(machine)!=MACHINE:raise ValueError('machine mismatch')
    START=time.monotonic()
    def timeout(_signal,_frame):raise TimeoutError('stage deadline')
    signal.signal(signal.SIGALRM,timeout);signal.alarm(75)
    PHASE='private-config';raw,pin=read_private(source);c=config(raw,profile);FORBIDDEN=(c['COS_SECRET_ID'],c['COS_SECRET_KEY'])
    OBSERVATIONS['machineIdentitySha256']=MACHINE;OBSERVATIONS['configSha256']=sha(raw)
    PHASE='existing-'+profile+'-identity';OBSERVATIONS['caller']=identity(c,APPLICATION if profile=='application' else BACKUP_READER)
    for name in (() if identity_only else ('policy','acl','lifecycle','replication','versioning','uploads')):
        PHASE='cos-'+name;value=cos_control(c,name,allow_absence=profile=='backup-reader')
        if len(json.dumps({**OBSERVATIONS,name:value}).encode())>204800:raise ValueError('aggregate metadata limit')
        OBSERVATIONS[name]=value
    PHASE='configuration-late-check';current,late=read_private(source)
    if pin!=late or sha(current)!=sha(raw):raise ValueError('config drift')
    signal.alarm(0)
    print(json.dumps({'status':'completed-readonly-cos-identity' if identity_only else 'completed-readonly-cos-controls','profile':profile,'observations':OBSERVATIONS,'productionMutation':False,'objectsDownloaded':False,'requests':CALLS}))
if __name__=='__main__':
    try:main()
    except Exception as error:
        known={'private file','file changed','duplicate config','invalid config','storage identity','stage limit','cloud read stopped','caller mismatch','identity shape','cloud identity error','identity envelope','request identity','request trace missing','sensitive response','authentication response field','authentication XML field','aggregate metadata limit','config drift','root required','machine mismatch','machine file','response nesting limit','unsupported XML','metadata root','TLS logging forbidden'}
        reason=str(error)if isinstance(error,ValueError)and str(error)in known else 'timeout'if isinstance(error,TimeoutError)else 'unclassified'
        print(json.dumps({'status':'stopped-readonly-cos-controls','phase':PHASE,'reasonCode':reason,'partialObservations':OBSERVATIONS,'productionMutation':False,'objectsDownloaded':False,'requests':CALLS}));sys.exit(1)
