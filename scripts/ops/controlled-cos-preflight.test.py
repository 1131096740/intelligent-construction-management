import importlib.util,json,unittest
from unittest.mock import patch
import time
import io,contextlib,stat,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('controlled-cos-preflight.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ReadonlyCosTests(unittest.TestCase):
    def test_identity_only_cli_verifies_existing_backup_before_any_permission_install(self):
        raw=b'DB_BACKUP_COS_BUCKET=jiangkong-prod-db-backups-1438687719\nDB_BACKUP_COS_REGION=ap-chengdu\nDB_BACKUP_COS_SECRET_ID=fixture-id\nDB_BACKUP_COS_SECRET_KEY=fixture-key\n';machine=b'fixture-machine';seen=[]
        class Meta:st_mode=stat.S_IFREG|0o644;st_nlink=1;st_uid=0;st_size=32
        row={'AccountId':m.OWNER,'UserId':'100050728192','PrincipalId':'100050728192','Arn':'qcs::cam:'+m.OWNER+':uin/100050728192','Type':'CAMUser','RequestId':'11111111-2222-3333-4444-555555555555'}
        def request(host,*args,**kwargs):
            seen.append(host);self.assertEqual(host,'sts.tencentcloudapi.com');m.CALLS+=1;return json.dumps({'Response':row}).encode()
        output=io.StringIO();m.OBSERVATIONS={};m.CALLS=0
        with patch.object(sys,'argv',['controlled-cos-preflight.py','backup-reader','identity-only']),patch.object(m.os,'getuid',lambda:0),patch.object(m.os,'open',lambda *args:10),patch.object(m.os,'fstat',lambda *args:Meta()),patch.object(m.os,'read',lambda *args:machine),patch.object(m.os,'close',lambda *args:None),patch.object(m,'MACHINE',m.sha(machine)),patch.object(m,'read_private',lambda path:(raw,('unchanged',))),patch.object(m,'request',request),patch.object(m.signal,'signal'),patch.object(m.signal,'alarm'),contextlib.redirect_stdout(output):
            m.main()
        result=json.loads(output.getvalue());self.assertEqual(result['status'],'completed-readonly-cos-identity');self.assertEqual(result['requests'],1);self.assertEqual(seen,['sts.tencentcloudapi.com']);self.assertNotIn('fixture-key',output.getvalue())
    def test_backup_reader_preserves_exact_404_absence_not_authentication_failure(self):
        c={'COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'}
        class Reply:
            status=404
            def getheader(self,key):return 'safe-cos-request-id'
            def read(self,limit):return b'<Error><Code>NoSuchReplicationConfiguration</Code><Message>not configured</Message></Error>'
        class Connection:
            def __init__(self,*args,**kwargs):pass
            def request(self,*args):pass
            def getresponse(self):return Reply()
            def close(self):pass
        m.START=time.monotonic();m.CALLS=0;m.FORBIDDEN=('fixture-id','fixture-key');m.OBSERVATIONS={};m.PHASE='cos-replication'
        with patch.object(m.http.client,'HTTPSConnection',Connection):
            result=m.cos_control(c,'replication',allow_absence=True)
            self.assertEqual(result['httpStatus'],404);self.assertEqual(result['errorCode'],'NoSuchReplicationConfiguration')
            self.assertIn('<Error>',result['rawResponse']);self.assertNotIn('ReplicationConfiguration/>',result['rawResponse'])
            with self.assertRaises(ValueError):m.cos_control(c,'replication')
            with patch.object(Reply,'read',lambda self,limit:b'<Error><Code>AccessDenied</Code></Error>'):
                with self.assertRaises(ValueError):m.cos_control(c,'replication',allow_absence=True)
    def test_existing_backup_reader_uses_backup_credentials_but_fixed_business_destination(self):
        raw=b'DB_BACKUP_COS_BUCKET=jiangkong-prod-db-backups-1438687719\nDB_BACKUP_COS_REGION=ap-chengdu\nDB_BACKUP_COS_SECRET_ID=fixture-id\nDB_BACKUP_COS_SECRET_KEY=fixture-key\nDB_BACKUP_COS_PREFIX=daily\n'
        c=m.config(raw,'backup-reader');self.assertEqual(c['COS_BUCKET'],m.BUCKET);self.assertEqual(c['COS_SECRET_ID'],'fixture-id')
        original=m.request
        try:
            row={'AccountId':m.OWNER,'UserId':'100050728192','PrincipalId':'100050728192','Arn':'qcs::cam:'+m.OWNER+':uin/100050728192','Type':'CAMUser','RequestId':'11111111-2222-3333-4444-555555555555'}
            m.request=lambda *args:json.dumps({'Response':row}).encode()
            self.assertEqual(m.identity(c,'100050728192')['UserId'],'100050728192')
            with self.assertRaisesRegex(ValueError,'caller mismatch'):m.identity(c)
            for tail in [b'DB_BACKUP_COS_TOKEN=\n',b'DB_BACKUP_COS_TMP_SECRET_ID=x\n']:
                with self.assertRaises(ValueError):m.config(raw+tail,'backup-reader')
            with self.assertRaises(ValueError):m.config(raw.replace(b'ap-chengdu',b'ap-beijing'),'backup-reader')
        finally:m.request=original
    def test_seven_requests_have_fixed_hosts_and_no_plaintext_key(self):
        c={'FILE_STORAGE_DRIVER':'cos','COS_BUCKET':m.BUCKET,'COS_REGION':'ap-chengdu','COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'};seen=[]
        def request(host,method,path,headers,body=None):
            seen.append((host,method,path));self.assertNotIn('fixture-key',headers.get('Authorization',''))
            if host=='sts.tencentcloudapi.com':return json.dumps({'Response':{'AccountId':m.OWNER,'UserId':m.APPLICATION,'PrincipalId':m.APPLICATION,'Arn':'qcs::cam:'+m.OWNER+':uin/'+m.APPLICATION,'Type':'CAMUser','RequestId':'11111111-2222-3333-4444-555555555555'}}).encode()
            if 'policy'in path:return b'{"version":"2.0","Statement":[]}'
            roots={'acl':'AccessControlPolicy','lifecycle':'LifecycleConfiguration','replication':'ReplicationConfiguration','versioning':'VersioningConfiguration','uploads':'ListMultipartUploadsResult'}
            name=next(key for key in roots if key+'='in path);return ('<'+roots[name]+'/>').encode()
        original=m.request
        try:
            m.request=request;self.assertEqual(m.identity(c)['UserId'],m.APPLICATION)
            for name in ('policy','acl','lifecycle','replication','versioning','uploads'):m.cos_control(c,name)
            self.assertEqual(len(seen),7);self.assertEqual(seen[0][:2],('sts.tencentcloudapi.com','POST'))
            self.assertTrue(all(host==m.BUCKET+'.cos.ap-chengdu.myqcloud.com'and method=='GET'for host,method,path in seen[1:]))
        finally:m.request=original
    def test_unknown_storage_and_wrong_caller_are_refused(self):
        with self.assertRaises(ValueError):m.config(b'COS_BUCKET=other\n')
        original=m.request
        try:
            m.request=lambda *args:json.dumps({'Response':{'AccountId':m.OWNER,'UserId':'other','PrincipalId':m.APPLICATION,'Arn':'qcs::cam:'+m.OWNER+':uin/'+m.APPLICATION,'Type':'CAMUser','RequestId':'11111111-2222-3333-4444-555555555555'}}).encode()
            with self.assertRaises(ValueError):m.identity({'COS_SECRET_ID':'fixture','COS_SECRET_KEY':'fixture'})
        finally:m.request=original
    def test_each_official_identity_coordinate_and_encoded_credentials_fail_closed(self):
        c={'COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'}
        row={'AccountId':m.OWNER,'UserId':m.APPLICATION,'PrincipalId':m.APPLICATION,'Arn':'qcs::cam:'+m.OWNER+':uin/'+m.APPLICATION,'Type':'CAMUser','RequestId':'11111111-2222-3333-4444-555555555555'}
        original=m.request
        try:
            for key in ['PrincipalId','Arn','Type','RequestId']:
                m.request=lambda *args:json.dumps({'Response':{**row,key:'wrong'}}).encode()
                with self.assertRaises(ValueError):m.identity(c)
            escaped=''.join('\\u%04x'%ord(x)for x in c['COS_SECRET_KEY'])
            xml=''.join('&#%d;'%ord(x)for x in c['COS_SECRET_ID'])
            for raw,name in [(('{"version":"2.0","Statement":[],"description":"'+escaped+'"}').encode(),'policy'),(('<AccessControlPolicy><ID>'+xml+'</ID></AccessControlPolicy>').encode(),'acl')]:
                m.request=lambda *args:raw
                with self.assertRaises(ValueError):m.cos_control(c,name)
        finally:m.request=original
    def test_embedded_json_and_namespaced_authentication_attribute_are_not_saved(self):
        c={'COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'}
        escaped=''.join('\\u%04x'%ord(x)for x in c['COS_SECRET_KEY'])
        inner='{"description":"'+escaped+'"}'
        raw=json.dumps({'version':'2.0','Statement':[],'Description':inner}).encode()
        with self.assertRaises(ValueError):m.protected_response(raw,c,'policy')
        with self.assertRaises(ValueError):m.protected_response(b'<AccessControlPolicy xmlns:a="http://fixture" a:SecretKey="opaque"/>',c,'acl')
        m.protected_response(json.dumps({'version':'2.0','Statement':[],'Description':'ordinary description about credential rules'}).encode(),c,'policy')
    def test_embedded_duplicate_keys_do_not_bypass_credential_guard(self):
        c={'COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'}
        escaped=''.join('\\u%04x'%ord(x)for x in c['COS_SECRET_KEY'])
        inner='{"note":"safe","note":"'+escaped+'"}'
        with self.assertRaises(ValueError):m.protected_response(json.dumps({'version':'2.0','Statement':[],'Description':inner}).encode(),c,'policy')
    def test_identity_uses_fixed_required_region_and_attributes_http200_cloud_error(self):
        c={'COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'};original=m.request
        def response(host,method,path,headers,body=None):
            self.assertEqual(headers.get('X-TC-Region'),'ap-chengdu')
            return json.dumps({'Response':{'Error':{'Code':'MissingParameter','Message':'fixture-key private error'},'RequestId':'11111111-2222-3333-4444-555555555555'}}).encode()
        try:
            m.request=response
            with self.assertRaisesRegex(ValueError,'cloud identity error'):m.identity(c)
            proof=m.OBSERVATIONS['identityDiagnostic'];self.assertEqual(proof['errorCode'],'MissingParameter');self.assertNotIn('fixture-key',json.dumps(proof));self.assertNotIn('Message',proof)
        finally:m.request=original
    def test_unknown_identity_shape_saves_counts_only_and_does_not_accept_success(self):
        c={'COS_SECRET_ID':'fixture-id','COS_SECRET_KEY':'fixture-key'};original=m.request
        try:
            m.request=lambda *args:json.dumps({'Response':{'AccountId':m.OWNER,'unknown fixture-key':'fixture-key'}}).encode()
            with self.assertRaisesRegex(ValueError,'identity shape'):m.identity(c)
            proof=m.OBSERVATIONS['identityDiagnostic'];self.assertEqual(proof['unexpectedFieldCount'],1);self.assertNotIn('fixture-key',json.dumps(proof));self.assertEqual(proof['missingKnownFields'],['Arn','PrincipalId','RequestId','Type','UserId'])
        finally:m.request=original
if __name__=='__main__':unittest.main()
