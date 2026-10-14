import { createHash } from 'node:crypto';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const BUSINESS_BUCKET = 'jiangkong-prod-files-1438687719';
export const PRINCIPALS = Object.freeze(['100049377606', '100050465776', '100050728192']);
// COS resources use APPID; CAM identity principal uses owner/sub-user UIN.
const resource = `qcs::cos:ap-chengdu:uid/1438687719:${BUSINESS_BUCKET}`;
const objectWrites = ['name/cos:PutObject*', 'name/cos:PostObject*', 'name/cos:DeleteObject*', 'name/cos:DeleteMultipleObjects', 'name/cos:InitiateMultipartUpload', 'name/cos:UploadPart*', 'name/cos:CompleteMultipartUpload', 'name/cos:AbortMultipartUpload'];

export function prepareCosHold(beforeBytes, runId,scope='known-identities') {
  if (!Buffer.isBuffer(beforeBytes) || beforeBytes.length > 65536 || !/^[a-z0-9-]{1,60}$/.test(runId)) throw Error('invalid pinned COS input');
  if(!['known-identities','known-and-anonymous'].includes(scope))throw Error('unsupported hold scope');
  const policy = JSON.parse(beforeBytes);
  const upper = Object.hasOwn(policy, 'Statement'), lower = Object.hasOwn(policy, 'statement');
  if (policy.version !== '2.0' || upper === lower) throw Error('ambiguous COS policy syntax');
  const key = upper ? 'Statement' : 'statement';
  if (!Array.isArray(policy[key]) || policy[key].some(row => row.Sid?.startsWith('ControlledFirstLaunch') || row.sid?.startsWith('ControlledFirstLaunch'))) throw Error('invalid or existing maintenance statement');
  const principal = uin => `qcs::cam::uin/100049377606:uin/${uin}`;
  const deny = (sid, who, actions, resources) => upper
    ? { Sid: sid, Effect: 'deny', Principal: { qcs: who }, Action: actions, Resource: resources }
    : { sid, effect: 'deny', principal: { qcs: who }, action: actions, resource: resources };
  const after = structuredClone(policy);
  after[key].push(deny('ControlledFirstLaunchObjects-' + runId, PRINCIPALS.map(principal), objectWrites, [resource + '/*']));
  // Block the two existing programmatic identities from undoing bucket holds.
  // Owner PUT Bucket Policy cannot be removed by a bucket policy; owner remains
  // the human-approved recovery authority, as documented in the trust model.
  after[key].push(deny('ControlledFirstLaunchManagement-' + runId, PRINCIPALS.slice(1).map(principal), ['name/cos:PutBucket*', 'name/cos:DeleteBucket*', 'name/cos:PostBucket*'], [resource, resource + '/*']));
  // Tencent COS '*' denies anonymous requests only, not signed CAM identities.
  if(scope==='known-and-anonymous')after[key].push(deny('ControlledFirstLaunchAnonymous-'+runId,['*'],objectWrites,[resource+'/*']));
  const bytes = Buffer.from(JSON.stringify(after) + '\n');
  return { beforeBytes: Buffer.from(beforeBytes), afterBytes: bytes, beforeSha256: hash(beforeBytes), afterSha256: hash(bytes), bucket: BUSINESS_BUCKET, region: 'ap-chengdu', writerCoverageVerified: false, productionApplied: false,holdScope:scope };
}

export function exactCosRollback(packet, observedBytes) {
  if (!Buffer.isBuffer(observedBytes) || hash(observedBytes) !== packet.afterSha256 || hash(packet.beforeBytes) !== packet.beforeSha256) throw Error('COS policy drift; do not overwrite');
  return Buffer.from(packet.beforeBytes);
}
