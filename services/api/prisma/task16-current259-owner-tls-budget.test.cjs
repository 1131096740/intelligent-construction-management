'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
// System-boundary time model, using root's pure-source R=377ms / F=3155ms
// measurements. No real SDK constructor, TLS, SQL, resource or tool operation.
test('the fixed owner stage can complete all checks at measured source costs without dropping checks',async t=>{
 const billing={clockMs:0,R:0,F:0};globalThis.__OWNER_TLS_BILLING=billing;t.after(()=>delete globalThis.__OWNER_TLS_BILLING);
 const ownerPath=path.join(__dirname,'task16-current259-owner-tls.cjs');
 const prelude=`'use strict';const Date={now:()=>globalThis.__OWNER_TLS_BILLING.clockMs,parse:globalThis.Date.parse};const __require=require;require=name=>{const port=__require(name);if(name!=='./task16-current259-owned-resource.cjs')return port;return {...port,claimCurrent259OwnedResource(...args){globalThis.__OWNER_TLS_BILLING.r();return port.claimCurrent259OwnedResource(...args);}};};\n`;
 const fakeFs={...fs,readFileSync(file,...args){return file===ownerPath?prelude+fs.readFileSync(file,'utf8'):fs.readFileSync(file,...args);}};
 const source=fs.readFileSync(path.join(__dirname,'task16-current259-owner-tls.test.cjs'),'utf8')+'\nmodule.exports={fixture};\n',instance={exports:{}};
 new Function('require','module','__dirname',source)(name=>name==='node:test'?{test(){}}:name==='node:fs'?fakeFs:require(name),instance,__dirname);
 const f=instance.exports.fixture(),rawCheck=f.view.check,rawLoader=f.view.loader;
 billing.r=()=>{billing.R++;billing.clockMs+=377;rawCheck();};
 f.view.check=billing.r;const credentials=f.view.credentials;f.view.credentials=()=>{billing.r();return credentials();};
 const receipt=f.view.resource.getReceipt;f.view.resource.getReceipt=()=>{billing.r();return receipt();};
 for(const key of ['execOwnerSql','setServerCertificate','captureLogCursor','readPlaintextRejectionEvidence']){const fn=f.view.resource[key];f.view.resource[key]=async(...args)=>{billing.r();const result=await fn(...args);billing.r();return result;};}
 f.view.loader=Object.freeze({...rawLoader,verifyFull(){billing.F++;billing.clockMs+=3155;return rawLoader.verifyFull();}});
 f.view.verifyFull=()=>{billing.r();f.view.loader.verifyFull();billing.r();};
 const proof=await f.api.verifyCurrent259OwnerTls(f.handle);
 assert.equal(f.state.constructed,7);assert.equal(f.state.disconnected,7);assert.equal(billing.R,423);assert.equal(billing.F,29);
 assert.equal(billing.clockMs,250966);assert.ok(billing.clockMs>180000);assert.ok(billing.clockMs<600000);
 assert.equal(f.api.claimCurrent259OwnerTls(proof,f.handle).scope,'CLOSED_OWNER_TLS_CONTROLS_ONLY');
});
