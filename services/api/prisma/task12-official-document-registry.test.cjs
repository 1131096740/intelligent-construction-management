'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateOfficialQualificationRegistration}=require('./task12-official-document-registry.cjs');
test('null registry and boolean activation cannot substitute for reviewed qualification',()=>{
 assert.throws(()=>validateOfficialQualificationRegistration({registry:{version:1,profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',qualification:null}}),{code:'TASK12_OFFICIAL_DOCUMENT_QUALIFICATION_PENDING'});
 assert.throws(()=>validateOfficialQualificationRegistration({registry:{version:1,profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',qualification:true}}),{code:'TASK12_OFFICIAL_DOCUMENT_REGISTRY'});
});

function registered(){
 const source={head:'1'.repeat(40),tree:'2'.repeat(40),sha256:'3'.repeat(64),files:100};
 const currentSource={head:'4'.repeat(40),tree:'5'.repeat(40),sha256:'6'.repeat(64),files:101};
 const base={version:1,pageCount:2,pages:['隔离工具资格材料合同 壹佰壹拾叁元整 资格样张材料 第1页 / 共2页','买方 虚构甲方公司 卖方 虚构乙方公司 第2页 / 共2页'],a4Portrait:true,outOfPageGlyphs:0,unembeddedFonts:0,badGlyphs:0,substitutionFonts:0,paintedChineseGlyphs:100,bodyAnchor:{matches:1,lineSpacings:[25],fontSizes:[14],fontFamilies:['fangsonggb2312']},failures:[]};
 const reports={java:{...base,pdfSha256:'a'.repeat(64)},office:{...base,pdfSha256:'b'.repeat(64)},normalized:{...base,pdfSha256:'c'.repeat(64),pageCount:4,pages:[...base.pages,...base.pages]}};
 const actions=Object.fromEntries(Object.entries(reports).map(([name,r])=>[name,{pdfPath:'/private/tmp/'+name+'.pdf',pdfSha256:r.pdfSha256,physicalPath:'/private/tmp/'+name+'.json',physicalSha256:'7'.repeat(64),pageCount:r.pageCount,
  verdict:{status:name==='java'?'MACHINE_FIDELITY_PASSED_PHYSICAL_REVIEW_PENDING':name==='office'?'OFFICE_TRANSPORT_PASSED_PHYSICAL_REVIEW_PENDING':'NORMALIZE_MERGE_PASSED_PHYSICAL_REVIEW_PENDING',pdfSha256:r.pdfSha256,pageCount:r.pageCount,runtimeAuthority:false,...(name==='java'?{exactPaginationReviewed:false}:name==='office'?{body25LayoutQualified:false}:{})}}]));
 const machine={version:1,status:'MACHINE_QUALIFICATION_PASSED_PHYSICAL_REVIEW_PENDING',profile:'TASK12_OFFICIAL_TEMURIN17_0_17_10_V1',runtimeAuthority:false,plan:{path:'/private/tmp/qualification.json',sha256:'8'.repeat(64)},source,hostBoundary:{platform:'darwin',arch:'arm64',release:'fixed-release',version:'fixed-version'},toolControls:{sha256:'f'.repeat(64),files:1000},candidateLockSha256:'cfdb0f202e91294db06aa8643be7955be6760a37b97d90c6baf9c261c76f0c45',buildSha256:'d'.repeat(64),materialSha256:'e'.repeat(64),boundaries:{foreignSnapshotRejected:true,malformedDocxRejected:true,externalRelationshipRejected:true,activeFieldRejected:true,noNegativeConverterScratchCreated:true},actions,physicalReview:{status:'PENDING',exactPageCountsReviewed:false,signatureAndPaginationReviewed:false},elapsedMs:10000};
 const physical={version:1,profile:machine.profile,status:'INDEPENDENT_PHYSICAL_REVIEW_PASSED',machineReceiptSha256:'a'.repeat(64),source,toolControlsSha256:'f'.repeat(64),pdfs:Object.fromEntries(Object.entries(reports).map(([n,r])=>[n,{sha256:r.pdfSha256,pageCount:r.pageCount}])),exactPageCountsReviewed:true,signatureAndPaginationReviewed:true,reviewer:'independent-model',reviewedAt:'2026-11-13T00:00:00Z'};
 return {registry:{version:1,profile:machine.profile,qualification:{machineReceipt:{path:'/private/tmp/machine.json',sha256:'a'.repeat(64)},physicalReview:{path:'/private/tmp/review.json',sha256:'b'.repeat(64)}}},machine,physical,machineSha256:'a'.repeat(64),physicalSha256:'b'.repeat(64),qualifiedPlan:{source},qualifiedPlanSha256:'8'.repeat(64),currentSource,currentHost:machine.hostBoundary,currentControls:{sha256:'f'.repeat(64),files:1000,source:currentSource},buildSha256:'d'.repeat(64),materialSha256:'e'.repeat(64),registrySha256:'9'.repeat(64),runtimeInput:{source:currentSource,qualificationRegistrySha256:'9'.repeat(64),qualificationPlanSha256:'8'.repeat(64)},reports};
}
test('reviewed immutable tool material can be rebound to a new complete source witness without issuing authority from JSON',()=>{
 const value=validateOfficialQualificationRegistration(registered());
 assert.equal(value.status,'REGISTERED_DATA_MATCHED_NOT_AUTHORITY');assert.equal(value.runtimeAuthority,false);
});


test('registration rejects old source, changed controls/material/build, false review and weakened boundaries',()=>{
 const changes=[
  value=>{value.currentHost={...value.currentHost,release:'other'};},
  value=>{value.currentControls.sha256='0'.repeat(64);},
  value=>{value.currentControls.source={...value.currentSource,head:'0'.repeat(40)};},
  value=>{value.runtimeInput.source={...value.currentSource,sha256:'0'.repeat(64)};},
  value=>{value.machine.source={...value.machine.source,tree:'0'.repeat(40)};},
  value=>{value.materialSha256='0'.repeat(64);},
  value=>{value.buildSha256='0'.repeat(64);},
  value=>{value.physical.exactPageCountsReviewed=false;},
  value=>{delete value.physical.signatureAndPaginationReviewed;},
  value=>{value.physical.machineReceiptSha256='0'.repeat(64);},
  value=>{value.machine.boundaries.activeFieldRejected=false;},
  value=>{value.runtimeInput.qualificationRegistrySha256='0'.repeat(64);},
  value=>{value.physical.pdfs.normalized.pageCount=2;},
  value=>{value.reports.java.bodyAnchor.lineSpacings=[26.05];}
 ];
 for(const change of changes){const value=structuredClone(registered());change(value);assert.throws(()=>validateOfficialQualificationRegistration(value));}
});
