'use strict';
// Local source/build/loader wiring only: no Nest app, PostgreSQL or converter.
const {test}=require('node:test'),assert=require('node:assert/strict');
test('default AppModule entry is a separately qualified fixed export; original view is retained',()=>{
 const {observeCurrent259Build}=require('./task16-current259-build.cjs');
 const {loadCurrent259Client,claimCurrent261OfficialDocumentModules}=require('./task16-current259-client-loader.cjs');
 const loader=loadCurrent259Client(observeCurrent259Build()),base=loader.loadCurrent261LocalLifecycleDocumentModules();
 const view=loader.loadCurrent261DefaultAppModules();
 assert.notEqual(view,base);assert.equal(view.runTask12Con18Withdrawal,base.runTask12Con18Withdrawal);
 assert.equal(typeof view.runTask12Con18DefaultApp,'function');
 assert.equal(claimCurrent261OfficialDocumentModules(view).source.candidateSha,loader.witness().source.candidateSha);
 loader.check();
});
