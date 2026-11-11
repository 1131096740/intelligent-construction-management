'use strict';

const {createHash}=require('node:crypto');
const {isDeepStrictEqual:equal,types}=require('node:util');

const FILE_NAME='首条对上原件.pdf';
const MIME='application/pdf';
const CONTRACT_NAME='首条对上直签合同';
const ORIGINAL_NUMBER='首条对上原号';
const BUSINESS_TYPE='material_purchase';
const DOWNLOAD_REASON='首条对上归档原件验收';
const ENTERPRISE_POSITION=Object.freeze({roleKey:'party_a',displayOrder:0});
const COMPANY_POSITION=Object.freeze({roleKey:'party_b',displayOrder:0});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA=/^[0-9a-f]{64}$/u;
const TOKEN=/^[A-Za-z0-9_-]{43}$/u;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const DATE=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const digest=value=>createHash('sha256').update(value).digest('hex');
const text=(value,pattern)=>typeof value==='string' && pattern.test(value);
const instant=value=>text(value,DATE) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
const generationId=value=>text(value,/^[\x21-\x7e]{1,1024}$/u) && value.toLowerCase()!=='null' && !value.includes(',');
function error(stage) { return Object.assign(new Error('CURRENT259_FIRST_Q2_CASE_'+stage),{code:'CURRENT259_FIRST_Q2_CASE_'+stage}); }
function need(ok,stage) { if(!ok)throw error(stage); }
function record(value,stage) {
  need(value && !types.isProxy(value) && Object.getPrototypeOf(value)===Object.prototype,stage);
  return value;
}
function requestSha(contract,version,actor,intent) {
  const parts=['contract-direct-archive-request-v1','2','direct_signed',contract,version,actor,
    intent.idempotencyKey,String(intent.expectedDraftRevision),intent.expectedInputSha256,'1',intent.fileIds[0],'true'];
  return digest(parts.map(value=>Buffer.byteLength(value,'utf8')+':'+value).join(''));
}
function ticketPath(raw,fileId,actor,expiresAt,reason) {
  const expected='/files/'+fileId+'/download';
  need(typeof raw==='string' && raw.length<=1024 && raw.startsWith(expected+'?') && !/[#\\\x00-\x20\x7f]/u.test(raw),'TICKET');
  const parsed=new URL(raw,'http://127.0.0.1');
  const parameters=parsed.searchParams;
  need(parsed.origin==='http://127.0.0.1' && parsed.pathname===expected &&
    equal([...parameters.keys()].sort(),['accessMode','actorUserId','downloadReason','expiresAt','token']) &&
    parameters.get('actorUserId')===actor && parameters.get('expiresAt')===expiresAt && instant(expiresAt) &&
    parameters.get('downloadReason')===reason && parameters.get('accessMode')==='download' &&
    text(parameters.get('token'),TOKEN),'TICKET');
  return raw;
}

function verifyOutsideSubjects(value,fixture){
  const subjects=record(value,'SAVE'), roles=record(subjects.roles,'SAVE');
  const {assignment,enterprise,counterparty}=fixture.outsideSubjects;
  const expectedParties=[enterprise,counterparty];
  need(equal(Object.keys(subjects).sort(),['enterprise','parties','roles']) &&
    equal(subjects.enterprise,{assignmentId:assignment.id,businessPartyId:enterprise.party.id,
      businessPartyVersionId:enterprise.version.id,name:assignment.affiliateNameSnapshot,
      creditCode:assignment.affiliateCreditCodeSnapshot,effectiveFrom:assignment.effectiveFrom}) &&
    Array.isArray(subjects.parties) && subjects.parties.length===2 &&
    subjects.parties.every((party,index)=>{
      const expected=expectedParties[index];
      return text(party?.cpsId,UUID) && party.displayOrder===0 &&
        party.roleKey===(index===0?'party_a':'party_b') && party.businessPartyVersionId===expected.version.id &&
        party.identity?.name===expected.version.snapshot.name &&
        party.identity?.unifiedSocialCreditCode===expected.version.snapshot.unifiedSocialCreditCode;
    }) &&
    equal(roles,{enterpriseCpsId:subjects.parties[0].cpsId,counterpartyCpsId:subjects.parties[1].cpsId}) &&
    roles.enterpriseCpsId!==roles.counterpartyCpsId,'SAVE');
  return true;
}

// Fixed, local request/response protocol. No listener, transport, seed write,
// native grant or storage operation can be created by this module.
function createCurrent259FirstQ2Case(fixture) {
  const {ids,phone,businessDate,operatingDate,uploadPrefix,pdf,contentSha256}=fixture;
  const outside=Boolean(fixture.counterparty);
  const relationship=outside?'outside':'upward';
  const filename=outside?'首条表外原件.pdf':FILE_NAME;
  const name=outside?'首条表外直签合同':CONTRACT_NAME;
  const originalNumber=outside?'首条表外原号':ORIGINAL_NUMBER;
  const reason=outside?'首条表外归档原件验收':DOWNLOAD_REASON;
  const file=Object.freeze({fileId:ids.upload,displayOrder:0,mimeType:MIME,sizeBytes:pdf.length,contentSha256});
  const mode=operatingDate?'internal_reference_only':'not_applicable';
  let cursor=0,issued=false,stopped=false,observed=false,uploadObserved=false,uploadGeneration;
  let password=fixture.password;
  let authorization,lease,contractId,versionId,revision,bucket,objectKey,q,inputSha,intent,outcome,downloadPath;
  const stop=()=>{stopped=true;password=undefined;authorization=undefined;lease=undefined;downloadPath=undefined;};
  const secured=(method,path,json,extra)=>{
    const headers=Object.freeze({authorization,...extra});
    return {method,path,headers,...(json===undefined?{}:{json})};
  };
  const draftPath=()=>'/contract-drafts/'+versionId;
  const archivePath=()=>'/contracts/'+versionId;
  const filePath='/files/'+ids.upload;
  const steps=[
    ['LOGIN',201,()=>({method:'POST',path:'/auth/login',json:Object.freeze({phone,password})}),body=>{
      const user=record(body.user,'LOGIN'),tokens=record(body.tokens,'LOGIN');
      need(user.id===ids.actor && user.phone===phone && user.mustChangePassword===false &&
        equal(user.roleKeys,['contract_staff']) && equal(user.globalRoleKeys,[]) &&
        text(tokens.accessToken,JWT) && tokens.accessToken.length<=4096,'LOGIN');
      authorization='Bearer '+tokens.accessToken;
    }],
    ['CREATE',201,()=>secured('POST','/contracts',{projectId:ids.project,contractTypeKey:BUSINESS_TYPE,
      numericProtocolVersion:2,handlingMode:'direct_signed',relationship}),body=>{
      const contract=record(body.contract,'CREATE'),version=record(body.version,'CREATE');
      need(text(contract.id,UUID) && text(version.id,UUID) && contract.id!==version.id &&
        contract.projectId===ids.project && contract.ownerUserId===ids.actor && contract.contractTypeKey===BUSINESS_TYPE &&
        version.contractId===contract.id && version.status==='draft' && version.versionNo===1 &&
        version.changeType==='original' && version.numericProtocolVersion===2 && version.draftRevision===1 &&
        version.firstSubmittedAt===null && body.terms===null,'CREATE');
      contractId=contract.id;versionId=version.id;revision=version.draftRevision;
    }],
    ['LEASE',201,()=>secured('POST',draftPath()+'/edit-lease'),body=>{
      need(text(body.token,TOKEN) && body.leaseRevision===1 && instant(body.expiresAt),'LEASE');
      lease=body.token;
    }],
    ['UPLOAD',201,()=>({...secured('POST',draftPath()+'/files'),multipart:Object.freeze({
      idempotencyKey:ids.upload,file:Object.freeze({field:'file',name:filename,mimeType:MIME,bytes:Buffer.from(pdf)}),
    })}),body=>{
      const key=typeof body.objectKey==='string' && body.objectKey.startsWith(uploadPrefix)?body.objectKey.slice(uploadPrefix.length):'';
      const physicalId=key.slice(0,36);
      need(body.id===ids.upload && body.uploadedByUserId===ids.actor && body.originalName===filename &&
        body.mimeType===MIME && body.sizeBytes===file.sizeBytes && body.contentSha256===contentSha256 &&
        body.storageStatus==='active' && body.purgeReceiptId===null && body.supersedesFileObjectId===null &&
        typeof body.bucket==='string' && /^[a-z0-9-]{3,100}$/u.test(body.bucket) && body.bucket!=='private-local' &&
        text(physicalId,UUID) && key===physicalId+'-'+contentSha256+'-'+filename,'UPLOAD');
      bucket=body.bucket;objectKey=body.objectKey;
    }],
    ['SAVE',200,()=>secured('PUT',draftPath(),{
      idempotencyKey:ids.save,expectedRevision:revision,saveKind:'manual',changedSections:['draft','parties','attachments'],
      draft:{...(!outside?{companyEntityId:ids.company}:{}),numericProtocolVersion:2,manualAmountYuan:'100.0054',originalSignedNumber:originalNumber,
        draftData:{contractName:name,contractBasics:{relationship,businessType:BUSINESS_TYPE,
          amountBasis:'tax_inclusive',invoiceStatus:'pending',settlementText:'按纸面结算'},directSigningInput:{protocolVersion:outside?1:2,
          source:'direct_signed',relationship,signedOn:businessDate,enterpriseParty:ENTERPRISE_POSITION,
          ...(outside?{counterpartyParty:COMPANY_POSITION}:{companyParty:COMPANY_POSITION,companyParticipationId:null}),
          fixedPaymentTermsVersionId:null}},clauses:[],pricingNature:'unit_price',amountSource:'manual',
        taxFacts:{invoiceType:null,taxMode:'single_rate',defaultTaxRatePercent:'13.25',source:'contract_document'}},
      parties:[{...ENTERPRISE_POSITION,businessPartyVersionId:ids.enterpriseVersion,snapshot:{}},
        ...(outside?[{...COMPANY_POSITION,businessPartyVersionId:fixture.counterparty.version.id,snapshot:{}}]:[])],bills:[],
      paymentTerms:{originalText:'以纸面原文为准',stages:[]},
      attachments:[{slotKey:'direct_signed_originals_v1',fileId:ids.upload,displayOrder:0}],negotiationDocuments:{referencedGeneratedDocumentIds:[]},
    },{'x-contract-draft-lease':lease}),body=>{
      const input=record(body.directSigningInput,'SAVE'),source=record(input.Q,'SAVE');
      const enterprise=source.subjects?.enterprise,company=source.subjects?.company;
      const correctSubjects=outside?verifyOutsideSubjects(source.subjects,fixture):equal(enterprise?.position,ENTERPRISE_POSITION) && equal(company?.position,COMPANY_POSITION) && enterprise?.assignmentId===ids.assignment &&
        enterprise?.businessPartyVersionId===ids.enterpriseVersion && company?.companyEntityId===ids.company &&
        company?.companyEntityVersionId===ids.companyVersion && company?.joinedCompanyEntityVersionId===ids.companyVersion &&
        company?.participationId===ids.participation;
      need(body.draftRevision===revision+1 && body.originalSignedNumber===originalNumber && body.versionAmount?.amountYuan==='100.0054' &&
        input.state==='complete' && text(input.inputSha256,SHA) && source.inputProtocolVersion===(outside?1:2) &&
        (!outside || input.protocolVersion===1 && input.sourceKind==='direct_signed_pending' && input.sourceRevision===body.draftRevision) &&
        equal(source.source,{kind:'direct_signed',relationship}) &&
        equal(source.locator,{projectId:ids.project,contractId,contractVersionId:versionId,draftRevision:body.draftRevision,versionNo:1,changeType:'original'}) &&
        source.contract?.businessType===BUSINESS_TYPE && source.contract?.name===name && source.contract?.signedOn===businessDate &&
        source.contract?.originalSignedNumber===originalNumber && equal(source.money,{numericProtocolVersion:2,amountYuan:'100.0054',
          amountLimitType:'capped',pricingNature:'unit_price',amountSource:'manual'}) &&
        equal(source.tax,{amountBasis:'tax_inclusive',invoiceType:null,taxMode:'single_rate',defaultTaxRatePercent:'13.250000'}) &&
        source.terms?.settlementText==='按纸面结算' && source.terms?.paymentTerms?.originalText==='以纸面原文为准' &&
        source.terms.paymentTerms.versionNo===1 && text(source.terms.paymentTerms.id,UUID) &&
        correctSubjects && equal(source.signedFiles,[file]),'SAVE');
      revision=body.draftRevision;inputSha=input.inputSha256;q=structuredClone(source);
      intent=Object.freeze({archiveProtocolVersion:2,archiveSource:'direct_signed',idempotencyKey:ids.archive,expectedDraftRevision:revision,
        expectedInputSha256:inputSha,fileIds:Object.freeze([ids.upload]),confirmedMatchingSignedDocument:true});
    }],
    ['ARCHIVE',201,()=>secured('POST',archivePath()+'/signed-archive',intent),body=>{
      need(text(body.archiveId,UUID) && equal(body,{archiveId:body.archiveId,contractVersionId:versionId,status:'effective',fileIds:[ids.upload]}),'ARCHIVE');
      outcome=Object.freeze({...body,fileIds:intent.fileIds});
    }],
    ['RECOVERY',200,()=>secured('GET',archivePath()+'/archive-requests/'+ids.archive),body=>{
      need(equal(body,{status:'archived',result:outcome,requestSha256:requestSha(contractId,versionId,ids.actor,intent),intent}),'RECOVERY');
    }],
    ['TICKET',201,()=>secured('POST',filePath+'/download-ticket',{confirmationPassword:password,downloadReason:reason}),body=>{
      need(body.fileId===ids.upload && body.fileName===filename && body.mimeType===MIME && body.sizeBytes===file.sizeBytes,'TICKET');
      downloadPath=ticketPath(body.downloadUrl,ids.upload,ids.actor,body.expiresAt,reason);
      password=undefined;
    }],
    ['DOWNLOAD',200,()=>({method:'GET',path:downloadPath}), (body,headers)=>{
      need(Buffer.isBuffer(body) && body.length===file.sizeBytes && digest(body)===contentSha256 &&
        headers?.['content-type']===MIME && headers?.['content-length']===String(file.sizeBytes) &&
        headers?.['content-disposition']==="attachment; filename*=UTF-8''"+encodeURIComponent(filename),'DOWNLOAD');
      authorization=undefined;lease=undefined;downloadPath=undefined;
    }],
  ];
  const readiness=()=>{need(cursor===steps.length && !stopped && !issued,'STATE');};
  const uploadReadiness=()=>{need(steps[cursor]?.[0]==='SAVE' && !issued && !stopped,'UPLOAD_OBSERVATION');};
  const physical=()=>({bucket,objectKey,mimeType:MIME,sizeBytes:file.sizeBytes,contentSha256});
  function observation() {
    readiness();
    need(!observed,'STATE');observed=true;
    return Object.freeze({actorId:ids.actor,projectId:ids.project,contractId,versionId,archiveId:outcome.archiveId,idempotencyKey:ids.archive,
      fileId:ids.upload,revision,inputSha256:inputSha,requestSha256:requestSha(contractId,versionId,ids.actor,intent)});
  }
  function verifyEvidence(evidence) {
    const expectedSha=requestSha(contractId,versionId,ids.actor,intent);
    const {archive,version,counts,archivedFile,archiveAudit,storage}=record(evidence,'EVIDENCE');
    need(archive?.id===outcome.archiveId && archive.contractVersionId===versionId && archive.uploadedByUserId===ids.actor &&
      archive.confirmedByUserId===ids.actor && instant(archive.confirmedAt) && archive.status==='confirmed' &&
      archive.archiveProtocolVersion===2 && archive.archiveSource==='direct_signed' && archive.idempotencyKey===ids.archive &&
      archive.requestSha256===expectedSha && archive.sourceRevision===revision && archive.approvalInstanceId===null && archive.sealTaskId===null &&
      typeof archive.authorityText==='string' && Buffer.byteLength(archive.authorityText)<=128*1024 &&
      text(archive.authoritySha256,SHA) && digest(archive.authorityText)===archive.authoritySha256,'EVIDENCE');
    need(typeof archive.qText==='string' && Buffer.byteLength(archive.qText)<=128*1024 && digest(archive.qText)===inputSha &&
      equal(JSON.parse(archive.qText),q) && typeof archive.fileManifestText==='string' && Buffer.byteLength(archive.fileManifestText)<=128*1024 &&
      text(archive.fileManifestSha256,SHA) && digest(archive.fileManifestText)===archive.fileManifestSha256 &&
      equal(JSON.parse(archive.fileManifestText),[file]),'EVIDENCE');
    need(equal(version,{id:versionId,contractId,status:'effective',draftRevision:revision,effectiveAt:archive.confirmedAt,taxFactsFrozenAt:archive.confirmedAt}) &&
      equal(counts,{archives:1,evidenceFiles:1,physicalAliases:0,draftSlots:0,approvalRounds:0,sealTasks:0,operatingFacts:0,operatingImpacts:0,
        archiveAudits:1,uploadAudits:1,downloadTicketAudits:1,downloadAudits:1}) &&
      equal(archivedFile,{...file,archiveFileId:outcome.archiveId,contractVersionId:versionId}) &&
      equal(archiveAudit,{actorUserId:ids.actor,action:'contract.archive.complete',businessType:'contract_version',businessId:versionId,
        metadata:{archiveId:outcome.archiveId,archiveSource:'direct_signed',sourceRevision:revision,
          inputSha256:inputSha,requestSha256:expectedSha,fileIds:[ids.upload],...(outside?{actingRoleKey:'contract_staff'}:{relationship})}}),'EVIDENCE');
    const authority=JSON.parse(archive.authorityText);
    const generationProof=evidence.generationProof;
    if(outside)need(generationProof?.protocolVersion===1 && generationProof.archiveId===outcome.archiveId &&
      generationProof.contractVersionId===versionId && generationProof.authoritySha256===archive.authoritySha256 &&
      authority.recipeVersion===undefined && authority.originals===undefined &&
      typeof evidence.sourceBasisText==='string' && Buffer.byteLength(evidence.sourceBasisText)<=128*1024 &&
      digest(evidence.sourceBasisText)===authority.sourceBasisSha256 &&
      equal(JSON.parse(evidence.sourceBasisText),authority.sourceBasis) &&
      equal(authority.sourceBasis.reviewScope,{excludedAmountYuan:'0.0000',sources:[]}) &&
      equal(authority.sourceBasis.fileManifest,[file]),'EVIDENCE');
    const originals=outside?generationProof.originals:authority?.originals;
    const generation=originals?.[0]?.objectGeneration;
    need((outside||authority?.recipeVersion==='contract-upward-direct-archive-v1/1') && authority.authorityProtocolVersion===1 &&
      authority.archiveSource==='direct_signed' && authority.projectId===ids.project && authority.contractId===contractId &&
      authority.contractVersionId===versionId && authority.handlerUserId===ids.actor && authority.sourceRevision===revision &&
      authority.requestSha256===expectedSha && authority.sourceBasis?.directInput?.inputSha256===inputSha &&
      equal(authority.sourceBasis.directInput.Q,q) && equal(authority.sourceBasis.businessTime,{archivedAt:archive.confirmedAt,businessDay:businessDate,...(outside?{handlerUserId:ids.actor}:{})}) &&
      equal(authority.fileManifest,[file]) && authority.fileManifestSha256===archive.fileManifestSha256 &&
      generationId(generation) && generation===uploadGeneration &&
      equal(originals,[{...file,bucket,objectKey,objectGeneration:generation}]) &&
      equal(authority.operatingConsequence,{protocolVersion:1,mode,operatingLedgerEffectiveDateSnapshot:operatingDate,expectedSource:null}),'EVIDENCE');
    const versioned={...physical(),objectGeneration:generation};
    need(equal(storage,{driver:'cos',versioning:'Enabled',upload:versioned,download:versioned}),'EVIDENCE');
    return generation;
  }
  return Object.freeze({
    next(){
      need(arguments.length===0 && cursor<steps.length && !issued && !stopped,'STATE');
      need(steps[cursor][0]!=='SAVE' || uploadGeneration!==undefined,'UPLOAD_OBSERVATION');
      issued=true;return Object.freeze(steps[cursor][2]());
    },
    accept(response){
      need(arguments.length===1 && cursor<steps.length && issued && !stopped,'STATE');
      const [stage,status,,check]=steps[cursor];
      try{
        need(record(response,stage).status===status,stage);
        check(stage==='DOWNLOAD'?response.body:record(response.body,stage),response.headers);
        cursor++;issued=false;
      }catch{stop();throw error(stage);}
    },
    uploadObservation(){
      uploadReadiness();need(arguments.length===0 && !uploadObserved,'UPLOAD_OBSERVATION');uploadObserved=true;
      return Object.freeze({fileId:ids.upload,...physical()});
    },
    acceptUploadObservation(value){
      uploadReadiness();need(arguments.length===1 && uploadObserved && uploadGeneration===undefined,'UPLOAD_OBSERVATION');
      try{
        const {objectGeneration}=record(value,'UPLOAD_OBSERVATION');
        need(generationId(objectGeneration) && equal(value,{driver:'cos',versioning:'Enabled',...physical(),objectGeneration}),
          'UPLOAD_OBSERVATION');
        uploadGeneration=objectGeneration;
      }catch{stop();throw error('UPLOAD_OBSERVATION');}
    },
    observation,
    finish(evidence){
      readiness();need(observed && arguments.length===1,'STATE');stop();
      let generation;
      try{generation=verifyEvidence(evidence);}catch{throw error('EVIDENCE');}
      return Object.freeze({status:outside?'CURRENT259_FIRST_OUTSIDE_DIRECT_PROTOCOL_MATCHED_NOT_ACCEPTANCE':'CURRENT259_FIRST_Q2_PROTOCOL_MATCHED_NOT_ACCEPTANCE',httpSteps:steps.length,operatingMode:mode,
        ...(outside?{persistedGenerationSha256:digest(generation)}:{}),
        executionAllowed:false,nativeAdmission:false,storageAcceptance:false});
    },
  });
}

module.exports=Object.freeze({createCurrent259FirstQ2Case});
