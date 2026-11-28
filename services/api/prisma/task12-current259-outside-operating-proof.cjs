'use strict';
const {createHash}=require('node:crypto');
const {isDeepStrictEqual:equal}=require('node:util');

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha=/^[0-9a-f]{64}$/u;
const xid=/^[1-9][0-9]{0,19}$/u;
const xmin=/^[1-9][0-9]{0,9}$/u;
const xmins=['archive','version','evidence','audit','intentUse','fact','impact'];
const factKind='downstream_contract';
const impactKind='contract_commitment_reference';
const commitment='100.0054';
const keys=['factId','impactId','factKind','impactKind','amountYuan','direction','intentPayloadSha256','issuedXmin','transactionId','commitStatus','xmins'];
const valid=(value,pattern)=>typeof value==='string'&&pattern.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
const ownKeys=(value,expected)=>Boolean(value && Object.getPrototypeOf(value)===Object.prototype &&
  equal(Object.keys(value).sort(),[...expected].sort()));

function verifyCurrent259OutsideOperatingReceipt(ledger){
  if(!ownKeys(ledger,keys) || !valid(ledger.factId,uuid) || !valid(ledger.impactId,uuid) || ledger.factId===ledger.impactId ||
    ledger.factKind!==factKind || ledger.impactKind!==impactKind || ledger.amountYuan!==commitment || ledger.direction!=='increase' ||
    !valid(ledger.intentPayloadSha256,sha) || !valid(ledger.issuedXmin,xmin) || BigInt(ledger.issuedXmin)>0xffffffffn ||
    ledger.commitStatus!=='committed' || !valid(ledger.transactionId,xid) || BigInt(ledger.transactionId)>0xffffffffffffffffn || !ownKeys(ledger.xmins,xmins))return false;
  const rowXmin=String(BigInt(ledger.transactionId)%4294967296n);
  return valid(rowXmin,xmin) && ledger.issuedXmin!==rowXmin && xmins.every(key=>ledger.xmins[key]===rowXmin);
}

// The persisted V2 use and separately committed issue come from the owner
// readback. The expected coordinates are fixed by the nine public requests.
function verifyCurrent259OutsideOperatingEvidence(ledger,proof){
  const {intent,xmins,fact,impact}=ledger;
  const {ids,archive,authority,q,originals,businessDate,operatingDate,sourceCode,contractId,versionId,revision,inputSha256,
    requestSha256,counterparty,archiveAudit}=proof;
  const ledgerReceipt={factId:fact.id,impactId:impact.id,factKind:fact.factKind,impactKind:impact.impactKind,
    amountYuan:fact.amountYuan,direction:impact.direction,intentPayloadSha256:intent.payloadSha256,
    issuedXmin:intent.issuedXmin,transactionId:intent.transactionId,commitStatus:intent.commitStatus,xmins};
  const need=ok=>{if(!ok)throw new Error('CURRENT259_FIRST_OUTSIDE_OPERATING_PROOF');};
  need(verifyCurrent259OutsideOperatingReceipt(ledgerReceipt)&&
    typeof intent.payloadText==='string'&&Buffer.byteLength(intent.payloadText)<=128*1024&&
    digest(intent.payloadText)===intent.payloadSha256);
  const input={Q:q,inputSha256};
  const debtor={...q.subjects.enterprise,kind:'construction_enterprise',id:ids.enterpriseVersion};
  const creditor={kind:'downstream_counterparty',id:counterparty.version.id,businessPartyId:counterparty.party.id,
    contractPartySnapshotId:q.subjects.roles.counterpartyCpsId,name:counterparty.party.name,creditCode:counterparty.party.unifiedSocialCreditCode};
  const factKey='contract_version:'+versionId,impactKey=factKey+':commitment';
  const reviewScope={economicExcludedYuan:'0.0000',sources:[]};
  const source={sourceType:'contract_version',sourceBusinessId:versionId};
  const consequence={protocolVersion:1,mode:'projection_required',operatingLedgerEffectiveDateSnapshot:operatingDate,
    reviewScope,debtor,creditor,expectedSource:{...source,sourceBusinessCode:sourceCode,sourceVersion:1,entryKind:'original',
      factKind,factIdempotencyKey:factKey,impactIdempotencyKey:impactKey,sourceImpactKey:impactKind,impactKind,
      numericProtocolVersion:2,amountState:'known',amountYuan:commitment,direction:'increase'}};
  need(equal(authority.operatingConsequence,consequence) && authority.sourceBasis.intentPayloadSha256===intent.payloadSha256 &&
    equal(authority.sourceBasis.reviewScope,reviewScope));
  const payload=JSON.parse(intent.payloadText);
  need(equal(payload,{protocolVersion:2,archiveSource:'direct_signed',relationship:'outside',actor:ids.actor,projectId:ids.project,
    contractId,contractVersionId:versionId,sourceRevision:revision,inputSha256,requestKey:ids.archive,requestSha256,
    orderedEvidence:originals,directInput:input,operatingConsequence:consequence}));
  need(equal(fact,{id:ledgerReceipt.factId,projectId:ids.project,...source,sourceBusinessCode:sourceCode,
    sourceVersion:1,entryKind:'original',factKind,idempotencyKey:factKey,status:'confirmed',direction:'neutral',
    amountCents:null,amountYuan:commitment,numericProtocolVersion:2,occurredAt:archive.confirmedAt,confirmedAt:archive.confirmedAt,
    confirmedByUserId:ids.actor,recordedByUserId:ids.actor,ledgerDate:operatingDate,debtorSubjectKind:debtor.kind,debtorSubjectId:debtor.id,
    creditorSubjectKind:creditor.kind,creditorSubjectId:creditor.id,affiliateAssignmentId:debtor.assignmentId,
    archiveId:archive.id,archiveAuthoritySha256:archive.authoritySha256,intentPayloadSha256:intent.payloadSha256,execution:[null,null,null]}) &&
    equal(impact,{id:ledgerReceipt.impactId,factId:fact.id,projectId:ids.project,...source,idempotencyKey:impactKey,impactKind,
      sourceImpactKey:impactKind,direction:'increase',amountCents:null,amountYuan:commitment,numericProtocolVersion:2,
      subjectRole:'debtor',subjectKind:debtor.kind,subjectId:debtor.id,execution:[null,null,null,null,null]}));
  need(equal(archiveAudit,{actorUserId:ids.actor,action:'contract.archive.complete',businessType:'contract_version',businessId:versionId,
    metadata:{archiveId:archive.id,archiveSource:'direct_signed',requestSha256,intentPayloadSha256:intent.payloadSha256,
      operatingFactId:fact.id,operatingImpactId:impact.id}}) &&
    equal(authority.sourceBasis.businessTime,{archivedAt:archive.confirmedAt,businessDay:businessDate,handlerUserId:ids.actor}));
  return Object.freeze({...ledgerReceipt,xmins:Object.freeze({...xmins})});
}
module.exports=Object.freeze({verifyCurrent259OutsideOperatingEvidence,verifyCurrent259OutsideOperatingReceipt});
