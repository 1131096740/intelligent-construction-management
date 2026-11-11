'use strict';

const {createHash,randomBytes}=require('node:crypto');
const {createCurrent259FirstQ2Case}=require('./task12-current259-q2-case.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BUSINESS_DATE=/^\d{4}-\d\d-\d\d$/u;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fixtures=new WeakSet();

function coordinate(runId,name,outside=false) {
  const namespace=outside?'current259-first-outside-direct':'current259-first-q2';
  const raw=hash(namespace+'/'+runId+'/'+name).slice(0,32);
  const variant=(Number.parseInt(raw[16],16)&3|8).toString(16);
  return [raw.slice(0,8),raw.slice(8,12),'4'+raw.slice(13,16),variant+raw.slice(17,20),raw.slice(20)].join('-');
}

function current259FirstQ2UploadPrefix(caseId) {
  if(arguments.length!==1 || typeof caseId!=='string' || !UUID.test(caseId))
    throw new Error('CURRENT259_FIRST_Q2_FIXTURE_INPUT');
  return 'uploads/idempotent/'+coordinate(caseId,'upload')+'/';
}

function current259FirstOutsideDirectUploadPrefix(caseId) {
  if(arguments.length!==1 || typeof caseId!=='string' || !UUID.test(caseId))
    throw new Error('CURRENT259_FIRST_Q2_FIXTURE_INPUT');
  return 'uploads/idempotent/'+coordinate(caseId,'upload',true)+'/';
}

function originalPdf() {
  // One blank PDF page, with offsets computed from the fixed ASCII bytes.
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>'];
  let pdf='%PDF-1.4\n';
  const offsets=[];
  objects.forEach((body,index)=>{
    offsets.push(pdf.length);
    pdf+=(index+1)+' 0 obj\n'+body+'\nendobj\n';
  });
  const xref=pdf.length;
  pdf+='xref\n0 4\n0000000000 65535 f \n'+offsets.map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('');
  return Buffer.from(pdf+'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n','ascii');
}

function buildFixture(runId,businessDate,operating,outside) {
  if(typeof runId!=='string' || !UUID.test(runId) ||
    typeof businessDate!=='string' || !BUSINESS_DATE.test(businessDate) || typeof operating!=='boolean')
    throw new Error('CURRENT259_FIRST_Q2_FIXTURE_INPUT');
  const date=new Date(businessDate+'T00:00:00.000Z');
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==businessDate)
    throw new Error('CURRENT259_FIRST_Q2_FIXTURE_INPUT');
  const ids=Object.freeze(Object.fromEntries(['actor','project','enterprise','enterpriseVersion','company','companyVersion',
    'assignment','participation','member','upload','save','archive'].map(name=>[name,coordinate(runId,name,outside)])));
  const previousDay=new Date(date.getTime()-86400000).toISOString();
  const previousChinaMidnight=new Date(date.getTime()-86400000-8*3600000).toISOString();
  const phone='1990000'+String(Number.parseInt(hash(runId).slice(0,7),16)%10000).padStart(4,'0');
  let password=randomBytes(32).toString('hex');
  const passwordHash=require('bcryptjs').hashSync(password,10);
  const suffix=runId.slice(0,8);
  const label=outside?'首条表外':'首条对上';
  const enterprise=label+'施工企业'+suffix,company=label+'参与公司'+suffix;
  const enterpriseCode='91350211M000100Y46',companyCode='91440300708461136T';
  const registeredAddress='隔离验收地址';
  const seed=Object.freeze(Object.fromEntries(Object.entries({
    User:{id:ids.actor,phone,name:label+'合同员'+suffix,passwordHash,mustChangePassword:false,isActive:true},
    Project:{id:ids.project,code:(outside?'OUTSIDE-':'Q2-')+runId,name:label+'项目'+suffix,operatingLedgerEffectiveDate:null,isActive:true},
    BusinessParty:{id:ids.enterprise,type:'organization',name:enterprise,normalizedName:enterprise,unifiedSocialCreditCode:enterpriseCode,
      status:'active',createdByUserId:ids.actor},
    BusinessPartyVersion:{id:ids.enterpriseVersion,businessPartyId:ids.enterprise,versionNo:1,createdByUserId:ids.actor,
      snapshot:Object.freeze({type:'organization',name:enterprise,unifiedSocialCreditCode:enterpriseCode,registeredAddress,attachments:Object.freeze([])})},
    CompanyEntity:{id:ids.company,name:company,unifiedSocialCreditCode:companyCode,registeredAddress,dataStatus:'complete',currentVersionNo:1,isActive:true},
    CompanyEntityVersion:{id:ids.companyVersion,companyEntityId:ids.company,versionNo:1,name:company,unifiedSocialCreditCode:companyCode,
      registeredAddress,isActive:true,action:'create',actorUserId:ids.actor},
    ProjectAffiliateAssignment:{id:ids.assignment,projectId:ids.project,businessPartyId:ids.enterprise,businessPartyVersionId:ids.enterpriseVersion,
      affiliateNameSnapshot:enterprise,affiliateCreditCodeSnapshot:enterpriseCode,effectiveFrom:previousChinaMidnight,endedAt:null,
      changeReason:label+'隔离验收',assignedByUserId:ids.actor},
    ProjectParticipatingCompany:{id:ids.participation,projectId:ids.project,companyEntityId:ids.company,companyEntityVersionId:ids.companyVersion,
      companyNameSnapshot:company,companyCreditCodeSnapshot:companyCode,effectiveFrom:previousDay,endedAt:null,changeReason:label+'隔离验收',addedByUserId:ids.actor},
    ProjectMember:{id:ids.member,projectId:ids.project,userId:ids.actor,positionKey:'contract_staff'},
  }).map(([table,row])=>[table,Object.freeze(row)])));
  // The fixed owner seed applies this once, after the ordered inserts above.
  // Project activation requires an existing assignment and continuous company coverage.
  const projectActivation=operating?Object.freeze({
    where:Object.freeze({id:ids.project,operatingLedgerEffectiveDate:null}),
    data:Object.freeze({operatingLedgerEffectiveDate:previousDay}),
  }):null;
  const uploadPrefix=outside?current259FirstOutsideDirectUploadPrefix(runId):current259FirstQ2UploadPrefix(runId);
  const downstreamName='首条表外相对方'+suffix;
  const downstreamId=coordinate(runId,'counterparty',true);
  const downstreamVersionId=coordinate(runId,'counterparty-version',true);
  const downstreamCode='911101080000000007';
  const counterparty=outside?Object.freeze({
    party:Object.freeze({id:downstreamId,type:'organization',name:downstreamName,normalizedName:downstreamName,
      unifiedSocialCreditCode:downstreamCode,status:'active',createdByUserId:ids.actor}),
    version:Object.freeze({id:downstreamVersionId,businessPartyId:downstreamId,versionNo:1,createdByUserId:ids.actor,
      snapshot:Object.freeze({type:'organization',name:downstreamName,unifiedSocialCreditCode:downstreamCode,registeredAddress,
        attachments:Object.freeze([])})}),
  }):null;
  const pdf=originalPdf();
  const original=Object.freeze({fileId:ids.upload,originalName:outside?'首条表外原件.pdf':'首条对上原件.pdf',mimeType:'application/pdf',
    sizeBytes:pdf.length,contentSha256:hash(pdf)});
  let used=false;
  const fixture=Object.freeze({seed,projectActivation,uploadPrefix,original,archiveIdempotencyKey:ids.archive,
    ...(outside?{relationship:'outside',counterparty}:{}),createCase(){
    if(arguments.length!==0 || used)throw new Error('CURRENT259_FIRST_Q2_FIXTURE_USED');
    used=true;
    try{
      return createCurrent259FirstQ2Case({ids,phone,password,businessDate,
        operatingDate:projectActivation?.data.operatingLedgerEffectiveDate.slice(0,10)??null,
        uploadPrefix,pdf,contentSha256:original.contentSha256,counterparty,
        ...(outside?{outsideSubjects:{assignment:seed.ProjectAffiliateAssignment,
          enterprise:{party:seed.BusinessParty,version:seed.BusinessPartyVersion},counterparty}}:{})});
    }finally{password=undefined;}
  }});
  fixtures.add(fixture);
  return fixture;
}

function buildCurrent259FirstQ2Fixture(runId,businessDate,operating) {
  if(arguments.length!==3)throw new Error('CURRENT259_FIRST_Q2_FIXTURE_INPUT');
  return buildFixture(runId,businessDate,operating,false);
}
function buildCurrent259FirstOutsideDirectFixture(runId,businessDate) {
  if(arguments.length!==2)throw new Error('CURRENT259_FIRST_Q2_FIXTURE_INPUT');
  return buildFixture(runId,businessDate,false,true);
}
module.exports=Object.freeze({buildCurrent259FirstQ2Fixture,buildCurrent259FirstOutsideDirectFixture,current259FirstQ2UploadPrefix,current259FirstOutsideDirectUploadPrefix,isCurrent259FirstQ2Fixture:value=>fixtures.has(value)});
