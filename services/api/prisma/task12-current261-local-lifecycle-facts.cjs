'use strict';
// Fixed, bounded readback expression. It carries no SQL port or live authority.
const {types}=require('node:util');
const need=ok=>{if(!ok)throw new Error('CURRENT261_LOCAL_LIFECYCLE_FACTS');};
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(x);
const own=(x,k)=>{need(x&&typeof x==='object'&&!types.isProxy(x));const d=Object.getOwnPropertyDescriptor(x,k);need(d&&Object.hasOwn(d,'value'));return d.value;};
function current261LocalLifecycleFacts(fixture,contractId,versionId,originalIds=[]){
 need((arguments.length===3||arguments.length===4)&&Array.isArray(originalIds)&&!types.isProxy(originalIds)&&(originalIds.length===0||originalIds.length===2&&new Set(originalIds).size===2)&&originalIds.every(uuid)&&fixture&&!types.isProxy(fixture)&&Object.isFrozen(fixture)&&uuid(contractId)&&uuid(versionId)&&contractId!==versionId);
 const approval=own(fixture,'approval'),projectId=own(own(approval,'project'),'id'),handlerId=own(own(approval,'handler'),'id');need(uuid(projectId)&&uuid(handlerId));
 const firstApprover=own(own(own(approval,'users'),'2'),'id');need(uuid(firstApprover));
 const v="'"+versionId+"'",c="'"+contractId+"'";
 const rows=(query,order)=>`(SELECT coalesce(jsonb_agg(to_jsonb(facts) ORDER BY ${order}),'[]'::jsonb) FROM (${query}) facts)`;
 return `(SELECT jsonb_build_object(
 'firstSignatureVersionCount',(SELECT count(*)::int FROM public."HandwrittenSignatureVersion" h WHERE h."userId"='${firstApprover}'),
 'counts',jsonb_build_array(
  (SELECT count(*)::int FROM public."ContractGeneratedDocument" g WHERE g."contractVersionId"=${v}),
  (SELECT count(*)::int FROM public."ApprovalInstance" a WHERE a."businessId"=${v} AND a."businessType"='contract_version'),
  (SELECT count(*)::int FROM public."ContractSealTask" s WHERE s."contractVersionId"=${v}),
  (SELECT count(*)::int FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=${v}),
  (SELECT count(*)::int FROM public."ContractArchiveEvidenceFile" e WHERE e."contractVersionId"=${v})),
 'originals',${originalIds.length?rows(`SELECT f.id,f."contentSha256" AS sha256,f."sizeBytes",(f.bucket='private-local' AND f."storageStatus"='active' AND f."mimeType"='application/pdf' AND f."uploadedByUserId"='${handlerId}') AS private FROM public."FileObject" f WHERE f.id IN (${originalIds.map(id=>"'"+id+"'").join(',')}) ORDER BY f.id LIMIT 3`,'facts.id'): "'[]'::jsonb"},
 'version',jsonb_build_object('id',v.id,'status',v.status,'draftRevision',v."draftRevision",'documentContentRevision',v."documentContentRevision",'documentContentFingerprint',v."documentContentFingerprint"),
 'generated',${rows(`SELECT g.id,g.status,g."engineVersion",g."docxFileId",g."pdfFileId" FROM public."ContractGeneratedDocument" g WHERE g."contractVersionId"=${v} ORDER BY g."createdAt",g.id LIMIT 4`,'facts.id')},
 'rounds',${rows(`SELECT a.id,a.status,(SELECT count(*)::int FROM public."ApprovalActionLog" l WHERE l."approvalInstanceId"=a.id AND l.action='approve') AS approves,(SELECT count(*)::int FROM public."ApprovalActionLog" l WHERE l."approvalInstanceId"=a.id AND l.action='approve' AND l."signatureFileIdSnapshot" IS NULL) AS unsigned FROM public."ApprovalInstance" a WHERE a."businessId"=${v} AND a."businessType"='contract_version' ORDER BY a."createdAt",a.id LIMIT 4`,'facts.id')},
 'approvedRoles',${rows(`SELECT l."approvedRoleKey" AS role,count(*)::int AS count,bool_and(l."signatureVersionIdSnapshot" IS NOT NULL AND l."signatureFileIdSnapshot" IS NOT NULL) AS signed FROM public."ApprovalActionLog" l JOIN public."ApprovalInstance" a ON a.id=l."approvalInstanceId" WHERE a."businessId"=${v} AND a."businessType"='contract_version' AND a.status='approved' AND l.action='approve' GROUP BY l."approvedRoleKey" ORDER BY l."approvedRoleKey" LIMIT 6`,'facts.role')},
 'sealTasks',${rows(`SELECT s.id,s.status,s."approvalInstanceId" FROM public."ContractSealTask" s WHERE s."contractVersionId"=${v} ORDER BY s."createdAt",s.id LIMIT 3`,'facts.id')},
 'archives',${rows(`SELECT a.id,a."authoritySha256",a."fileManifestSha256",a."idempotencyKey" FROM public."ContractArchiveFile" a WHERE a."contractVersionId"=${v} ORDER BY a."createdAt",a.id LIMIT 2`,'facts.id')},
 'evidence',${rows(`SELECT e."fileId",e."displayOrder",e."contentSha256",e."sizeBytes",(f.bucket='private-local' AND f."storageStatus"='active' AND f."contentSha256"=e."contentSha256" AND f."sizeBytes"=e."sizeBytes") AS private FROM public."ContractArchiveEvidenceFile" e JOIN public."FileObject" f ON f.id=e."fileId" WHERE e."contractVersionId"=${v} ORDER BY e."displayOrder" LIMIT 3`,'facts."displayOrder"')},
 'audit',${rows(`SELECT a.action,count(*)::int AS count FROM public."AuditLog" a WHERE a."businessId"=${v} AND a."businessType"='contract_version' AND a.action IN ('contract.archive.complete','contract.seal.complete','contract.archive_task.create') GROUP BY a.action ORDER BY a.action LIMIT 3`,'facts.action')}
 ) FROM public."ContractVersion" v JOIN public."Contract" c ON c.id=v."contractId"
 WHERE v.id=${v} AND c.id=${c} AND c."projectId"='${projectId}' AND c."ownerUserId"='${handlerId}' AND c."contractTypeKey"='material_purchase' AND v."numericProtocolVersion"=2)`;
}
function current261LocalLifecycleFileFacts(fixture,contractId,versionId,generationIds){
 need(arguments.length===4&&fixture&&!types.isProxy(fixture)&&Object.isFrozen(fixture)&&uuid(contractId)&&uuid(versionId)&&contractId!==versionId&&
  Array.isArray(generationIds)&&!types.isProxy(generationIds)&&generationIds.length>0&&generationIds.length<=3&&generationIds.every(uuid)&&new Set(generationIds).size===generationIds.length);
 const approval=own(fixture,'approval'),projectId=own(own(approval,'project'),'id'),handlerId=own(own(approval,'handler'),'id');need(uuid(projectId)&&uuid(handlerId));
 const file=alias=>`jsonb_build_object('id',${alias}.id,'sha256',${alias}."contentSha256",'sizeBytes',${alias}."sizeBytes",'mimeType',${alias}."mimeType",'private',${alias}.bucket='private-local' AND ${alias}."storageStatus"='active' AND ${alias}."uploadedByUserId"='${handlerId}')`;
 return `(SELECT coalesce(jsonb_agg(jsonb_build_object('generationId',g.id,'docx',${file('d')},'pdf',${file('p')}) ORDER BY g.id),'[]'::jsonb)
 FROM public."ContractGeneratedDocument" g JOIN public."ContractVersion" v ON v.id=g."contractVersionId" JOIN public."Contract" c ON c.id=v."contractId"
 JOIN public."FileObject" d ON d.id=g."docxFileId" JOIN public."FileObject" p ON p.id=g."pdfFileId"
 WHERE v.id='${versionId}' AND c.id='${contractId}' AND c."projectId"='${projectId}' AND c."ownerUserId"='${handlerId}' AND c."contractTypeKey"='material_purchase'
 AND v."numericProtocolVersion"=2 AND g.id IN (${generationIds.map(id=>"'"+id+"'").join(',')}))`;
}
module.exports=Object.freeze({current261LocalLifecycleFacts,current261LocalLifecycleFileFacts});
