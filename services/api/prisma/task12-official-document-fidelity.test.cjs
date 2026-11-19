'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {validateOfficialDocumentFidelity}=require('./task12-official-document-fidelity.cjs');
const good=()=>({version:1,pdfSha256:'a'.repeat(64),pageCount:2,pages:['隔离工具资格材料合同 壹佰壹拾叁元整 资格样张材料 第1页 / 共2页','买方 虚构甲方公司 卖方 虚构乙方公司 第2页 / 共2页'],a4Portrait:true,outOfPageGlyphs:0,unembeddedFonts:0,badGlyphs:0,substitutionFonts:0,paintedChineseGlyphs:100,bodyAnchor:{matches:1,lineSpacings:[25,25],fontSizes:[14],fontFamilies:['fangsonggb2312']},failures:[]});
test('independent physical metrics retain the manual page/signature review hold',()=>{
 const result=validateOfficialDocumentFidelity(good(),'a'.repeat(64));
 assert.equal(result.status,'MACHINE_FIDELITY_PASSED_PHYSICAL_REVIEW_PENDING');assert.equal(result.runtimeAuthority,false);
});
test('missing visible words, font outlines, body spacing and page bounds fail closed',()=>{
 for(const change of [r=>{r.pages[0]='missing';},r=>{r.badGlyphs=1;},r=>{r.unembeddedFonts=1;},r=>{r.substitutionFonts=1;},r=>{r.outOfPageGlyphs=1;},r=>{r.bodyAnchor.lineSpacings=[26.05];},r=>{r.bodyAnchor.fontFamilies=['simhei'];},r=>{r.pages[1]='买方 only';},r=>{r.pdfSha256='b'.repeat(64);}]){
  const r=good();change(r);assert.throws(()=>validateOfficialDocumentFidelity(r,'a'.repeat(64)),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});
 }
});

test('source-only build command uses the fixed pnpm CLI and a private credential-free environment',()=>{
 const {describeOfficialBuildCommand}=require('../../../scripts/qualify-task12-official-document-runtime.cjs');
 const command=describeOfficialBuildCommand('/private/tmp/owned-build');
 assert.equal(command.executable,'/Users/leoyang/.nvm/versions/node/v20.20.2/bin/node');
 assert.deepEqual(command.argv,['/Users/leoyang/.local/lib/node_modules/pnpm/bin/pnpm.cjs','--filter','@jiangkong/api','build']);
 assert.equal(command.env.npm_execpath,'/Users/leoyang/.local/lib/node_modules/pnpm/bin/pnpm.cjs');
 assert.equal(command.env.HOME,'/private/tmp/owned-build/home');
 assert.equal(command.env.npm_config_userconfig,'/dev/null');
 assert.equal(command.env.npm_config_globalconfig,'/dev/null');
 assert.equal(command.env.PYTHONDONTWRITEBYTECODE,'1');
 assert.equal(command.env.NODE_OPTIONS,undefined);assert.equal(command.env.DATABASE_URL,undefined);
});

test('office transport does not claim body25 layout and normalized merge must preserve every independently observed page',()=>{
 const {validateOfficialOfficeFidelity,validateOfficialMergedFidelity}=require('./task12-official-document-fidelity.cjs');
 const office=good();office.pdfSha256='b'.repeat(64);office.bodyAnchor.lineSpacings=[26.05];
 assert.equal(validateOfficialOfficeFidelity(office,'b'.repeat(64)).body25LayoutQualified,false);
 const merged={...good(),pdfSha256:'c'.repeat(64),pageCount:4,pages:[...good().pages,...office.pages]};
 assert.equal(validateOfficialMergedFidelity(merged,good(),office,'c'.repeat(64)).pageCount,4);
 merged.pages[2]='dropped page';assert.throws(()=>validateOfficialMergedFidelity(merged,good(),office,'c'.repeat(64)));
});

test('real footer regression rejects blank, repeated and wrong-total page numbers',()=>{
 for(const replace of [text=>text.replace('第1页 / 共2页','第 页 / 共 页'),text=>text.replace('共2页','共1页')]){
  const report=good();report.pages[0]=replace(report.pages[0]);
  assert.throws(()=>validateOfficialDocumentFidelity(report,report.pdfSha256),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});
 }
 const repeated=good();repeated.pages[1]=repeated.pages[1].replace('第2页','第1页');
 assert.throws(()=>validateOfficialDocumentFidelity(repeated,repeated.pdfSha256),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});
});

test('each page has exactly one correct page label and rejects coexisting duplicates or conflicts',()=>{
 const {validateOfficialOfficeFidelity}=require('./task12-official-document-fidelity.cjs');
 for(const extra of [' 第1页 / 共2页',' 第2页 / 共99页',' 第 页 / 共 页',' 第01页 / 共2页',' 第一页 / 共两页']){
  const report=good();report.pages[0]+=extra;
  for(const validate of [validateOfficialDocumentFidelity,validateOfficialOfficeFidelity]){
   assert.throws(()=>validate(report,report.pdfSha256),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});
  }
 }
});

test('mechanical fidelity checks actual mechanical roles without material 25pt claims',()=>{
 const api=require('./task12-official-document-fidelity.cjs');
 const report=good();report.pages=['隔离工具资格机械合同 资格样张设备 租赁机械设备名称、规格型号、数量及金额 第1页/共2页','甲方 虚构甲方公司 乙方 虚构乙方公司 第2页/共2页'];
 report.bodyAnchor={matches:1,lineSpacings:[],fontSizes:[14],fontFamilies:['simhei']};
 const result=api.validateOfficialMechanicalFidelity(report,report.pdfSha256);
 assert.equal(result.status,'MECHANICAL_FIDELITY_PASSED_PHYSICAL_REVIEW_PENDING');assert.equal(result.runtimeAuthority,false);
 for(const change of [r=>{r.bodyAnchor.fontFamilies=['fangsonggb2312'];},r=>{r.bodyAnchor.fontSizes=[12];},r=>{r.badGlyphs=1;},r=>{r.pages[1]='甲方only';},r=>{r.pages[0]='material only';}]){
  const bad=structuredClone(report);change(bad);assert.throws(()=>api.validateOfficialMechanicalFidelity(bad,bad.pdfSha256),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});
 }
 assert.throws(()=>validateOfficialDocumentFidelity(report,report.pdfSha256),{code:'TASK12_OFFICIAL_DOCUMENT_FIDELITY'});
});
test('current mechanical gate rejects misplaced company, bank and supplemental text',()=>{
 const {validateOfficialMechanicalCurrentFidelity}=require('./task12-official-document-fidelity.cjs');
 const report=good();report.pageCount=3;report.pages=['隔离工具资格机械合同 虚构甲方公司 虚构乙方公司 资格样张设备 第1页/共3页','虚构甲方补充说明 虚构乙方补充说明 第2页/共3页','甲方 虚构甲方公司 乙方 虚构乙方公司 虚构甲方开户行 虚构乙方开户行 TESTACCOUNT-A TESTACCOUNT-B 第3页/共3页'];
 assert.equal(validateOfficialMechanicalCurrentFidelity(report,report.pdfSha256).runtimeAuthority,false);
 assert.throws(()=>validateOfficialMechanicalCurrentFidelity(report,report.pdfSha256,true));
 report.bodyAnchor={matches:1,lineSpacings:[],fontSizes:[14],fontFamilies:['simhei']};
 assert.equal(validateOfficialMechanicalCurrentFidelity(report,report.pdfSha256,true).runtimeAuthority,false);
 for(const change of [r=>{r.pages[1]+='虚构甲方公司';},r=>{r.pages[1]+='TESTACCOUNT-A';},r=>{r.pages[2]+='虚构乙方补充说明';},r=>{r.pages[2]=r.pages[2].replace('TESTACCOUNT-B','');}]){
  const bad=structuredClone(report);change(bad);assert.throws(()=>validateOfficialMechanicalCurrentFidelity(bad,bad.pdfSha256));
 }
});
