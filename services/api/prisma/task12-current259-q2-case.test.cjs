'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');

test('the first Q2 fixed case starts with phone login and seeds only its project and original subjects',()=>{
  const {buildCurrent259FirstQ2Fixture}=require('./task12-current259-q2-fixture.cjs');
  const fixture=buildCurrent259FirstQ2Fixture('12345678-1234-4234-8234-123456789012','2026-11-11',false);
  assert.deepEqual(Object.keys(fixture.seed),['User','Project','BusinessParty','BusinessPartyVersion','CompanyEntity',
    'CompanyEntityVersion','ProjectAffiliateAssignment','ProjectParticipatingCompany','ProjectMember']);
  assert.equal(fixture.seed.User.mustChangePassword,false);
  assert.equal(fixture.seed.Project.operatingLedgerEffectiveDate,null);
  assert.equal(fixture.seed.ProjectMember.positionKey,'contract_staff');
  assert.notEqual(fixture.seed.CompanyEntity.unifiedSocialCreditCode,fixture.seed.BusinessParty.unifiedSocialCreditCode);
  const request=fixture.createCase().next();
  assert.equal(request.method,'POST');
  assert.equal(request.path,'/auth/login');
  assert.equal(request.json.phone,fixture.seed.User.phone);
  assert.match(request.json.password,/^[0-9a-f]{64}$/u);
});

const {createHash}=require('node:crypto');
const {buildCurrent259FirstQ2Fixture}=require('./task12-current259-q2-fixture.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const runId='12345678-1234-4234-8234-123456789012';
const day='2026-11-11';
const contractId='11111111-1111-4111-8111-111111111111';
const versionId='22222222-2222-4222-8222-222222222222';
const archiveId='33333333-3333-4333-8333-333333333333';
const physicalSuffix='44444444-4444-4444-8444-444444444444';
const termsId='55555555-5555-4555-8555-555555555555';
const expiresAt='2026-11-11T12:35:00.000Z';
const accessToken='fixture.access.token';
const leaseToken='a'.repeat(43);
const mimeType='application/pdf';

function drive({operating=false,outside=false,change=(stage,response)=>response,earlyVersion='q2-real-version-model',omitVersion=false}={}) {
  const fixture=outside?require('./task12-current259-q2-fixture.cjs').buildCurrent259FirstOutsideDirectFixture(runId,day)
    :buildCurrent259FirstQ2Fixture(runId,day,operating);
  const flow=fixture.createCase(), relationship=outside?'outside':'upward';
  const fileName=outside?'首条表外原件.pdf':'首条对上原件.pdf';
  const reason=outside?'首条表外归档原件验收':'首条对上归档原件验收';
  const originalNumber=outside?'首条表外原号':'首条对上原号';
  const {seed}=fixture, actor=seed.User.id, project=seed.Project.id;
  const file=fixture.uploadPrefix.split('/')[2], prefix='/contract-drafts/'+versionId;
  const responses=[];
  function reply(method,path,status,body,headers){
    const req=flow.next();
    assert.equal(req.method,method);
    assert.equal(req.path,path);
    responses.push(req);
    flow.accept(change(responses.length,{status,body,headers}));
    return req;
  }
  reply('POST','/auth/login',201,{user:{id:actor,phone:seed.User.phone,roleKeys:['contract_staff'],globalRoleKeys:[],mustChangePassword:false},tokens:{accessToken}});
  const create=reply('POST','/contracts',201,{contract:{id:contractId,projectId:project,ownerUserId:actor,contractTypeKey:'material_purchase'},
    version:{id:versionId,contractId,status:'draft',versionNo:1,changeType:'original',numericProtocolVersion:2,draftRevision:1,firstSubmittedAt:null},terms:null});
  assert.deepEqual(create.json,{projectId:project,contractTypeKey:'material_purchase',numericProtocolVersion:2,handlingMode:'direct_signed',relationship});
  assert.equal(create.headers.authorization,'Bearer '+accessToken);
  reply('POST',prefix+'/edit-lease',201,{token:leaseToken,leaseRevision:1,expiresAt});
  const upload=flow.next();
  assert.equal(upload.path,prefix+'/files');
  assert.equal(upload.method,'POST');
  assert.equal(upload.multipart.idempotencyKey,file);
  assert.equal(upload.multipart.file.field,'file');
  assert.equal(upload.multipart.file.name,fileName);
  const bytes=upload.multipart.file.bytes, sha=digest(bytes),bucket='isolated-q2-cos-bucket';
  const key=fixture.uploadPrefix+physicalSuffix+'-'+sha+'-'+fileName;
  responses.push(upload);
  flow.accept(change(4,{status:201,body:{id:file,bucket,objectKey:key,originalName:fileName,mimeType,sizeBytes:bytes.length,
    contentSha256:sha,uploadedByUserId:actor,storageStatus:'active',supersedesFileObjectId:null,purgeReceiptId:null}}));
  const storage={bucket,objectKey:key,objectGeneration:'q2-real-version-model',mimeType,sizeBytes:bytes.length,contentSha256:sha};
  if(!omitVersion){
    assert.deepEqual(flow.uploadObservation(),{fileId:file,bucket,objectKey:key,mimeType,sizeBytes:bytes.length,contentSha256:sha});
    flow.acceptUploadObservation({driver:'cos',versioning:'Enabled',...storage,objectGeneration:earlyVersion});
  }
  const signedFiles=[{fileId:file,displayOrder:0,mimeType,sizeBytes:bytes.length,contentSha256:sha}];
  const Q={inputProtocolVersion:outside?1:2,source:{kind:'direct_signed',relationship},
    locator:{projectId:project,contractId,contractVersionId:versionId,draftRevision:2,versionNo:1,changeType:'original'},
    contract:{businessType:'material_purchase',name:outside?'首条表外直签合同':'首条对上直签合同',signedOn:day,originalSignedNumber:originalNumber},
    money:{numericProtocolVersion:2,amountYuan:'100.0054',amountLimitType:'capped',pricingNature:'unit_price',amountSource:'manual'},
    tax:{amountBasis:'tax_inclusive',invoiceType:null,taxMode:'single_rate',defaultTaxRatePercent:'13.250000'},
    terms:{settlementText:'按纸面结算',paymentTerms:{id:termsId,versionNo:1,originalText:'以纸面原文为准'}},
    subjects:outside?{enterprise:{assignmentId:seed.ProjectAffiliateAssignment.id,businessPartyId:seed.BusinessParty.id,
      businessPartyVersionId:seed.BusinessPartyVersion.id,name:seed.BusinessParty.name,creditCode:seed.BusinessParty.unifiedSocialCreditCode,
      effectiveFrom:seed.ProjectAffiliateAssignment.effectiveFrom},roles:{enterpriseCpsId:archiveId,counterpartyCpsId:termsId},
      parties:[{cpsId:archiveId,roleKey:'party_a',displayOrder:0,businessPartyVersionId:seed.BusinessPartyVersion.id,
        identity:{name:seed.BusinessParty.name,unifiedSocialCreditCode:seed.BusinessParty.unifiedSocialCreditCode,
          legalRepresentative:null,address:null,contactName:null,contactPhone:null}},
        {cpsId:termsId,roleKey:'party_b',displayOrder:0,businessPartyVersionId:fixture.counterparty.version.id,
          identity:{name:fixture.counterparty.party.name,unifiedSocialCreditCode:fixture.counterparty.party.unifiedSocialCreditCode,
            legalRepresentative:null,address:null,contactName:null,contactPhone:null}}]}:{enterprise:{position:{roleKey:'party_a',displayOrder:0},assignmentId:seed.ProjectAffiliateAssignment.id,businessPartyVersionId:seed.BusinessPartyVersion.id},
      company:{position:{roleKey:'party_b',displayOrder:0},companyEntityId:seed.CompanyEntity.id,companyEntityVersionId:seed.CompanyEntityVersion.id,
        joinedCompanyEntityVersionId:seed.CompanyEntityVersion.id,participationId:seed.ProjectParticipatingCompany.id}},
    signedFiles};
  const qText=JSON.stringify(Q),inputSha256=digest(qText);
  const save=reply('PUT',prefix,200,{draftRevision:2,originalSignedNumber:originalNumber,versionAmount:{amountYuan:'100.0054'},
    directSigningInput:{state:'complete',inputSha256,Q,...(outside?{protocolVersion:1,sourceRevision:2,sourceKind:'direct_signed_pending'}:{})}});
  assert.equal(save.headers['x-contract-draft-lease'],leaseToken);
  assert.deepEqual(save.json.changedSections,['draft','parties','attachments']);
  assert.deepEqual(save.json.attachments,[{slotKey:'direct_signed_originals_v1',fileId:file,displayOrder:0}]);
  if(outside){
    assert.equal(save.json.draft.companyEntityId,undefined);
    assert.equal(save.json.draft.draftData.directSigningInput.protocolVersion,1);
    assert.deepEqual(save.json.parties.map(party=>party.businessPartyVersionId),
      [seed.BusinessPartyVersion.id,fixture.counterparty.version.id]);
  }else assert.equal(save.json.draft.draftData.directSigningInput.companyParticipationId,null);
  const result={archiveId,contractVersionId:versionId,status:'effective',fileIds:[file]};
  const archive=reply('POST','/contracts/'+versionId+'/signed-archive',201,result);
  const keyId=archive.json.idempotencyKey;
  const parts=['contract-direct-archive-request-v1','2','direct_signed',contractId,versionId,actor,keyId,'2',inputSha256,'1',file,'true'];
  const requestSha256=digest(parts.map(value=>Buffer.byteLength(value)+':'+value).join(''));
  reply('GET','/contracts/'+versionId+'/archive-requests/'+keyId,200,{status:'archived',result,requestSha256,intent:archive.json});
  const ticketPath='/files/'+file+'/download?'+new URLSearchParams({actorUserId:actor,expiresAt,downloadReason:reason,
    accessMode:'download',token:'b'.repeat(43)});
  const ticket=reply('POST','/files/'+file+'/download-ticket',201,{fileId:file,fileName,mimeType,sizeBytes:bytes.length,expiresAt,downloadUrl:ticketPath});
  assert.deepEqual(ticket.json,{confirmationPassword:responses[0].json.password,downloadReason:reason});
  const downloaded=reply('GET',ticketPath,200,bytes,{'content-type':mimeType,'content-length':String(bytes.length),
    'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fileName)});
  assert.equal(downloaded.headers,undefined);
  const time='2026-11-11T12:00:00.000Z';
  const fileManifestText=JSON.stringify(signedFiles),fileManifestSha256=digest(fileManifestText);
  const sourceBasis={directInput:{inputSha256,Q},businessTime:{archivedAt:time,businessDay:day,...(outside?{handlerUserId:actor}:{})},
    ...(outside?{reviewScope:{excludedAmountYuan:'0.0000',sources:[]},fileManifest:signedFiles}:{})};
  const sourceBasisText=JSON.stringify(sourceBasis);
  const originals=[{...signedFiles[0],bucket,objectKey:key,objectGeneration:storage.objectGeneration}];
  const authority={...(outside?{sourceBasisSha256:digest(sourceBasisText)}:{recipeVersion:'contract-upward-direct-archive-v1/1',originals}),
    authorityProtocolVersion:1,archiveSource:'direct_signed',projectId:project,contractId,contractVersionId:versionId,
    handlerUserId:actor,sourceRevision:2,requestSha256,sourceBasis,fileManifest:signedFiles,fileManifestSha256,
    operatingConsequence:{protocolVersion:1,mode:operating?'internal_reference_only':'not_applicable',
      operatingLedgerEffectiveDateSnapshot:operating?'2026-11-10':null,expectedSource:null}};
  const authorityText=JSON.stringify(authority);
  const evidence={archive:{id:archiveId,contractVersionId:versionId,uploadedByUserId:actor,confirmedByUserId:actor,confirmedAt:time,
    status:'confirmed',archiveProtocolVersion:2,archiveSource:'direct_signed',idempotencyKey:keyId,requestSha256,sourceRevision:2,
    authorityText,authoritySha256:digest(authorityText),qText,fileManifestText,fileManifestSha256,approvalInstanceId:null,sealTaskId:null},
    version:{id:versionId,contractId,status:'effective',
      draftRevision:2,effectiveAt:time,taxFactsFrozenAt:time},counts:{archives:1,evidenceFiles:1,physicalAliases:0,draftSlots:0,approvalRounds:0,
      sealTasks:0,operatingFacts:0,operatingImpacts:0,archiveAudits:1,uploadAudits:1,downloadTicketAudits:1,downloadAudits:1},
    archivedFile:{...signedFiles[0],archiveFileId:archiveId,contractVersionId:versionId},
    archiveAudit:{actorUserId:actor,action:'contract.archive.complete',businessType:'contract_version',businessId:versionId,
      metadata:{archiveId,archiveSource:'direct_signed',sourceRevision:2,inputSha256,requestSha256,fileIds:[file],
        ...(outside?{actingRoleKey:'contract_staff'}:{relationship})}},
    ...(outside?{sourceBasisText,generationProof:{protocolVersion:1,archiveId,contractVersionId:versionId,
      authoritySha256:digest(authorityText),originals}}:{}),
    storage:{driver:'cos',versioning:'Enabled',upload:storage,download:{...storage}}};
  return {flow,evidence,responses};
}

test('same-key Q2 protocol verifies all nine responses and the independently supplied fixed version',()=>{
  for(const operating of [false,true]){
    const {flow,evidence,responses}=drive({operating});
    assert.equal(responses.length,9);
    const observed=flow.observation();
    assert.equal(observed.archiveId,archiveId);
    assert.equal(observed.versionId,versionId);
    assert.equal(observed.requestSha256,evidence.archive.requestSha256);
    assert.deepEqual(flow.finish(evidence),{
      status:'CURRENT259_FIRST_Q2_PROTOCOL_MATCHED_NOT_ACCEPTANCE',httpSteps:9,operatingMode:operating?'internal_reference_only':'not_applicable',
      executionAllowed:false,nativeAdmission:false,storageAcceptance:false,
    });
  }
});

test('mutated login roles, COS key, Q2 source and durable proof stop at the first mismatched response',()=>{
  const scenarios=[
    [1,'LOGIN',body=>({...body,user:{...body.user,globalRoleKeys:['super_admin']}})],
    [4,'UPLOAD',body=>({...body,objectKey:'other-prefix/file.pdf'})],
    [5,'SAVE',body=>({...body,directSigningInput:{...body.directSigningInput,Q:{...body.directSigningInput.Q,
      money:{...body.directSigningInput.Q.money,amountYuan:'900.0054'}}}})],
    [7,'RECOVERY',body=>({...body,requestSha256:'0'.repeat(64)})],
    [8,'TICKET',body=>({...body,downloadUrl:'http://127.0.0.1'+body.downloadUrl})],
    [8,'TICKET',body=>({...body,downloadUrl:body.downloadUrl+'&token='+'e'.repeat(43)})],
    [9,'DOWNLOAD',body=>Buffer.alloc(body.length)],
  ];
  for(const [step,code,mutate] of scenarios)assert.throws(()=>drive({change:(index,response)=>index===step?
    {...response,body:mutate(response.body)}:response}),{code:'CURRENT259_FIRST_Q2_CASE_'+code});
});

test('the original key, bytes and matching COS generation are required together for the final protocol record',()=>{
  for(const mutate of [
    evidence=>{evidence.storage.download.objectGeneration='another-version';},
    evidence=>{evidence.storage.driver='local';},
    evidence=>{evidence.archive.qText+=' ';},
    evidence=>{evidence.archiveAudit.metadata.requestSha256='0'.repeat(64);},
    evidence=>{evidence.counts.operatingImpacts=1;},
  ]){
    const {flow,evidence}=drive();
    flow.observation();mutate(evidence);
    assert.throws(()=>flow.finish(evidence),{code:'CURRENT259_FIRST_Q2_CASE_EVIDENCE'});
    assert.throws(()=>flow.finish(evidence),{code:'CURRENT259_FIRST_Q2_CASE_STATE'});
  }
});

test('the fixed upload generation must be observed before save and remain the archived generation',()=>{
  assert.throws(()=>drive({omitVersion:true}),/CASE_UPLOAD_OBSERVATION/u);
  const {flow,evidence}=drive({earlyVersion:'older-upload-generation'});
  flow.observation();
  assert.throws(()=>flow.finish(evidence),/CASE_EVIDENCE/u);
});

test('invalid time and a repeated fixture or in-flight request cannot advance the case',()=>{
  assert.throws(()=>buildCurrent259FirstQ2Fixture(runId,'2026-02-30',false),/FIXTURE_INPUT/u);
  const fixture=buildCurrent259FirstQ2Fixture(runId,day,true),flow=fixture.createCase();
  assert.equal(fixture.seed.Project.operatingLedgerEffectiveDate,null);
  assert.equal(fixture.seed.ProjectAffiliateAssignment.effectiveFrom,'2026-11-09T16:00:00.000Z');
  assert.throws(()=>fixture.createCase(),/FIXTURE_USED/u);
  const login=flow.next();
  assert.ok(require('bcryptjs').compareSync(login.json.password,fixture.seed.User.passwordHash));
  assert.throws(()=>flow.next(),/CASE_STATE/u);
  assert.throws(()=>flow.accept({status:503,body:{}}),/CASE_LOGIN/u);
  assert.throws(()=>flow.next(),/CASE_STATE/u);
});

test('both fixture modes insert a dormant project before the single scoped operating activation',()=>{
  const {readFileSync}=require('node:fs');
  const {join}=require('node:path');
  const migration=name=>readFileSync(join(__dirname,'migrations',name,'migration.sql'),'utf8');
  const initial=migration('20260814010000_project_operating_profile');
  const current=migration('20260912100000_pol284_participant_history_integrity');
  assert.match(initial,/FUNCTION "rejectInitiallyActiveProjectOperatingLedger"\(\)[\s\S]*?NEW\."operatingLedgerEffectiveDate" IS NOT NULL[\s\S]*?ERRCODE = '23514'/u);
  assert.match(initial,/TRIGGER "Project_reject_initial_operating_ledger"\s+BEFORE INSERT ON "Project"/u);
  assert.match(current,/FUNCTION "activateProjectOperatingLedger"\(\)[\s\S]*?"hasProjectParticipatingCompanyCoverage"\(\s+OLD\."id"[\s\S]*?NEW\."operatingLedgerEffectiveDate"/u);
  assert.match(current,/daterange\(ledger_effective_date, NULL, '\[\)'\)\s+<@ COALESCE\(covered_periods/u);

  for(const operating of [true,false]){
    const fixture=buildCurrent259FirstQ2Fixture(runId,day,operating);
    const inserts=Object.entries(fixture.seed);
    const inserted=new Map();
    for(const [model,row] of inserts){
      if(model==='Project')assert.equal(row.operatingLedgerEffectiveDate,null,'the actual BEFORE INSERT guard requires NULL');
      if(['ProjectAffiliateAssignment','ProjectParticipatingCompany'].includes(model))assert.equal(row.projectId,inserted.get('Project').id);
      inserted.set(model,row);
    }
    if(!operating){assert.equal(fixture.projectActivation,null);continue;}
    const project=inserted.get('Project'),assignment=inserted.get('ProjectAffiliateAssignment'),company=inserted.get('ProjectParticipatingCompany');
    const activation=fixture.projectActivation;
    assert.deepEqual(activation,{where:{id:project.id,operatingLedgerEffectiveDate:null},
      data:{operatingLedgerEffectiveDate:'2026-11-10T00:00:00.000Z'}});
    assert.ok(Object.isFrozen(activation) && Object.isFrozen(activation.where) && Object.isFrozen(activation.data));
    assert.equal(project.operatingLedgerEffectiveDate,activation.where.operatingLedgerEffectiveDate);
    assert.equal(company.effectiveFrom,activation.data.operatingLedgerEffectiveDate);
    assert.equal(company.endedAt,null);
    assert.equal(assignment.endedAt,null);
    assert.ok(assignment.effectiveFrom<=activation.data.operatingLedgerEffectiveDate);
    assert.equal(inserted.has('ContractVersion'),false);
    assert.equal(inserted.has('OperatingFact'),false);
  }
});

test('the separate outside scenario uses the downstream business party and rejects upward inputs and proofs',()=>{
  const {buildCurrent259FirstOutsideDirectFixture}=require('./task12-current259-q2-fixture.cjs');
  const fixture=buildCurrent259FirstOutsideDirectFixture(runId,day);
  assert.equal(fixture.relationship,'outside');
  assert.notEqual(fixture.counterparty.party.id,fixture.seed.BusinessParty.id);
  assert.notEqual(fixture.counterparty.version.id,fixture.seed.BusinessPartyVersion.id);
  assert.equal(fixture.projectActivation,null);
  const flow=fixture.createCase();
  flow.next();
  assert.throws(()=>flow.accept({status:201,body:{user:{id:fixture.seed.User.id,phone:fixture.seed.User.phone,
    roleKeys:['contract_staff'],globalRoleKeys:['super_admin'],mustChangePassword:false},tokens:{accessToken}}}),/CASE_LOGIN/u);
  assert.throws(()=>flow.next(),/CASE_STATE/u);
});

test('outside runs the nine steps and binds same-key archive, audit and separate fixed-generation proof',()=>{
  const {flow,evidence,responses}=drive({outside:true});
  assert.equal(responses.length,9);
  assert.equal(flow.observation().requestSha256,evidence.archive.requestSha256);
  assert.deepEqual(flow.finish(evidence),{status:'CURRENT259_FIRST_OUTSIDE_DIRECT_PROTOCOL_MATCHED_NOT_ACCEPTANCE',
    httpSteps:9,operatingMode:'not_applicable',persistedGenerationSha256:digest('q2-real-version-model'),
    executionAllowed:false,nativeAdmission:false,storageAcceptance:false});
});
test('outside rejects Q2 source, a mismatched actor, and a replaced archived generation',()=>{
  assert.throws(()=>drive({outside:true,change(stage,response){
    if(stage===5) response.body.directSigningInput.Q.source.relationship='upward';
    return response;
  }}),/CASE_SAVE/u);
  for(const change of [
    e=>{e.archiveAudit.actorUserId=archiveId;},
    e=>{e.generationProof.originals[0].objectGeneration='other-generation';},
    e=>{e.generationProof.authoritySha256='f'.repeat(64);},
  ]){
    const {flow,evidence}=drive({outside:true});
    flow.observation();
    change(evidence);
    assert.throws(()=>flow.finish(evidence),/CASE_EVIDENCE/u);
  }
});

test('Q1 SAVE rejects an upward company identity or a wrong party snapshot before issuing archive',()=>{
  for(const mutate of [
    subjects=>{subjects.company={companyEntityId:contractId};},
    subjects=>{subjects.parties[1].identity.name='其他下游单位';},
    subjects=>{subjects.parties[0].identity.unifiedSocialCreditCode='OTHER';},
    subjects=>{subjects.parties[1].businessPartyVersionId=versionId;},
  ]){
    assert.throws(()=>drive({outside:true,change(stage,response){
      if(stage===5)mutate(response.body.directSigningInput.Q.subjects);
      return response;
    }}),/CASE_SAVE/u);
  }
});
