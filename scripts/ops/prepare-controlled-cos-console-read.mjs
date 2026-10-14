import {createHash} from 'node:crypto';
const digest=b=>createHash('sha256').update(b).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
function parseReceipt(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>4096)throw Error('bounded failed receipt required');
 const raw=bytes.toString('utf8'),data=JSON.parse(raw);let compact='',quoted=false,escaped=false;
 for(const c of raw){if(quoted){compact+=c;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}else if(c==='"'){quoted=true;compact+=c;}else if(!/\s/.test(c))compact+=c;}
 // This accepts the fixed producer's ordinary JSON form only. Duplicate keys,
 // alternate escaped spellings and numerical encodings are refused, never folded.
 if(JSON.stringify(data)!==compact)throw Error('noncanonical or duplicate failed receipt');return data;
}
export function prepareCosConsoleRead(bytes){
 const d=parseReceipt(bytes),o=d.partialObservations;
 if(!exact(d,['status','phase','reasonCode','requests','productionMutation','objectsDownloaded','partialObservations'])||d.status!=='stopped-readonly-cos-controls'||d.phase!=='cos-policy'||d.reasonCode!=='cloud read stopped'||d.requests!==2||d.productionMutation!==false||d.objectsDownloaded!==false)throw Error('wrong failed stage');
 if(!exact(o,['machineIdentitySha256','configSha256','caller','responseProofs','lastResponse'])||o.machineIdentitySha256!=='f909d7eaa061e2fe304778b77da1e767585fef7218d36493796efa9bfa8bb916'||!/^[a-f0-9]{64}$/.test(o.configSha256??''))throw Error('wrong target observation');
 const c=o.caller;if(!exact(c,['Type','AccountId','UserId','PrincipalId','Arn','RequestId'])||c.Type!=='CAMUser'||c.AccountId!=='100049377606'||c.UserId!=='100050465776'||c.PrincipalId!==c.UserId||c.Arn!=='qcs::cam:100049377606:uin/100050465776'||!/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(c.RequestId??''))throw Error('unverified exact caller');
 if(!Array.isArray(o.responseProofs)||o.responseProofs.length!==1)throw Error('wrong response count');const p=o.responseProofs[0];
 if(!exact(p,['phase','httpStatus','requestId','bodySha256'])||p.phase!=='cos-policy'||p.httpStatus!==403||!/^[A-Za-z0-9+/=_-]{1,160}$/.test(p.requestId??'')||!/^[a-f0-9]{64}$/.test(p.bodySha256??'')||!exact(o.lastResponse,['httpStatus','errorCode'])||o.lastResponse.httpStatus!==403||o.lastResponse.errorCode!=='AccessDenied')throw Error('actual policy denial required');
 return {status:'prepared-owner-console-read-proposal',sourceStoppedOriginalSha256:digest(bytes),target:{ownerUin:'100049377606',bucket:'jiangkong-prod-files-1438687719',region:'ap-chengdu',consoleStartUrl:'https://console.cloud.tencent.com/cos'},maximumConfigPages:6,maximumSeconds:600,configPages:['policy','acl','lifecycle','replication','versioning','multipart-uploads'],productionExecuted:false,applicationPermissionChange:false,authorizesMutation:false,observationIsApiRaw:false,contractChoice:'controlled-first-launch owner-console observations; manual configuration stage requires separate exact before/after approval',stopConditions:['wrong owner/bucket/region','unknown identity/access/completeness','pagination beyond one page or more than 100 multipart entries','unable to obtain complete policy JSON or determine saved state','sensitive key/value displayed','timeout or tool rejection'],rollback:'no production mutation; leave configuration and unknown tabs unchanged, preserve safe partial observations',notAuthorityReceipt:true};
}
