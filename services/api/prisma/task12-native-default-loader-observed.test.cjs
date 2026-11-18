'use strict';
// Local source/build/loader wiring only: no Nest app, PostgreSQL or converter.
const {test}=require('node:test'),assert=require('node:assert/strict');
test('node:test main retains the original view and rejects the default AppModule entry',()=>{
 const {observeCurrent259Build}=require('./task16-current259-build.cjs');
 const {loadCurrent259Client,claimCurrent261OfficialDocumentModules}=require('./task16-current259-client-loader.cjs');
 const loader=loadCurrent259Client(observeCurrent259Build()),base=loader.loadCurrent261LocalLifecycleDocumentModules();
 assert.equal(typeof base.runTask12Con18Withdrawal,'function');
 assert.equal(claimCurrent261OfficialDocumentModules(base).source.candidateSha,loader.witness().source.candidateSha);
 assert.throws(()=>loader.loadCurrent261DefaultAppModules(),{code:'CURRENT261_DEFAULT_APP_MODULE_SOURCE'});
 // Positive default-view qualification requires the real fixed main after its NOT_READY gate is lifted.
 loader.check();
});
