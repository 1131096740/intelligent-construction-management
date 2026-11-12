'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createOfficialDocumentChildBudget}=require('./task12-official-document-child.cjs');
test('child materials are checked on both sides and the operation keeps its first error',async()=>{
 let checks=0;const primary=Object.assign(new Error('first child exit'),{code:'CHILD_EXIT'});
 const budget=createOfficialDocumentChildBudget({checkMaterials(){if(++checks===2)throw Error('postcheck');},remainingTotalMilliseconds(){return 1000;}},1000);
 await assert.rejects(budget.run(async()=>{throw primary;}),error=>error===primary&&error.postcheckFailure.message==='postcheck');
 assert.equal(checks,2);
});
test('a failed material precheck never launches a child',async()=>{
 let ran=false;const budget=createOfficialDocumentChildBudget({checkMaterials(){throw Error('changed');},remainingTotalMilliseconds(){return 1000;}},1000);
 await assert.rejects(budget.run(async()=>{ran=true;}),/changed/u);assert.equal(ran,false);
});
test('precheck costs consume the fixed deadline instead of receiving a fresh child timeout',async()=>{
 const budget=createOfficialDocumentChildBudget({checkMaterials(){},remainingTotalMilliseconds(){return 1000;}},1,performance.now()-10);
 await assert.rejects(budget.run(async()=>assert.fail('expired must not start')),{code:'TASK12_OFFICIAL_DOCUMENT_DEADLINE'});
});


test('later continuity errors never overwrite a child error that already carries an earlier postcheck',()=>{
 const {attachPostcheck}=require('./task12-official-document-child.cjs');
 const primary=Object.assign(Error('original child'),{code:'CHILD_EXIT'}),first=Error('first check'),later=Error('final check');
 assert.equal(attachPostcheck(primary,first),primary);
 const combined=attachPostcheck(primary,later);
 assert.equal(combined.cause,primary);assert.equal(primary.postcheckFailure,first);assert.deepEqual(combined.errors,[primary,later]);
});
