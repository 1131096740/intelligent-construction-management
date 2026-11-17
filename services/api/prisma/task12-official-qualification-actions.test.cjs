'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runOfficialQualificationActions}=require('./task12-official-qualification-actions.cjs');
test('first Java child failure stops before LO, inspection or normalization',async()=>{
 const calls=[];const first=Object.assign(new Error('first Java failure'),{code:'JAVA_FAILED'});
 const ports=Object.fromEntries(['negative','java','inspectJava','office','inspectOffice','normalize','inspectNormalized'].map(name=>[name,async()=>{calls.push(name);if(name==='java')throw first;return name;} ]));
 await assert.rejects(runOfficialQualificationActions(ports),error=>error===first);
 assert.deepEqual(calls,['negative','java']);
});
test('full tool composition keeps per-action physical reports and never issues runtime authority',async()=>{
 const calls=[];const ports=Object.fromEntries(['negative','java','inspectJava','office','inspectOffice','normalize','inspectNormalized'].map(name=>[name,async()=>{calls.push(name);return name;} ]));
 const result=await runOfficialQualificationActions(ports);
 assert.deepEqual(calls,['negative','java','inspectJava','office','inspectOffice','normalize','inspectNormalized']);
 assert.equal(result.status,'MACHINE_QUALIFICATION_PASSED_PHYSICAL_REVIEW_PENDING');assert.equal(result.runtimeAuthority,false);
 assert.equal(result.javaPhysical,'inspectJava');assert.equal(result.officePhysical,'inspectOffice');assert.equal(result.normalizedPhysical,'inspectNormalized');
});
test('current mechanical qualification retains all old gates and requires both new conversions and inspections',async()=>{
 const names=['negative','java','inspectJava','office','inspectOffice','normalize','inspectNormalized','javaCurrent','inspectJavaCurrent','officeCurrent','inspectOfficeCurrent'];
 const calls=[],ports=Object.fromEntries(names.map(name=>[name,async()=>{calls.push(name);return name;}]));
 const result=await runOfficialQualificationActions(ports);assert.deepEqual(calls,names);assert.equal(result.officeCurrentPhysical,'inspectOfficeCurrent');
 delete ports.inspectOfficeCurrent;await assert.rejects(runOfficialQualificationActions(ports));
});
test('current qualification stops before Office on current Java failure',async()=>{
 const names=['negative','java','inspectJava','office','inspectOffice','normalize','inspectNormalized','javaCurrent','inspectJavaCurrent','officeCurrent','inspectOfficeCurrent'];
 const calls=[],error=new Error('current java failed'),ports=Object.fromEntries(names.map(name=>[name,async()=>{calls.push(name);if(name==='javaCurrent')throw error;return name;}]));
 await assert.rejects(runOfficialQualificationActions(ports),value=>value===error);assert.deepEqual(calls,names.slice(0,8));
});
