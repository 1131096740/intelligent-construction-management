'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectCleanupDiagnostics}=require('./task12-cleanup-diagnostic.cjs');
test('projects only fixed cleanup diagnostics from the bounded error cause chain',()=>{
 const inner=Object.assign(Error('private'),{appCleanupDiagnostics:['CLOSE_FAILED','SERVER_LISTENING']});
 assert.deepEqual(projectCleanupDiagnostics({cause:inner}),['CLOSE_FAILED','SERVER_LISTENING']);
 assert.equal(projectCleanupDiagnostics({cause:{appCleanupDiagnostics:['private']}}),undefined);
 const trap={};Object.defineProperty(trap,'appCleanupDiagnostics',{get(){throw Error('getter');}});
 assert.equal(projectCleanupDiagnostics({cause:trap}),undefined);
 assert.equal(projectCleanupDiagnostics(new Proxy({},{})),undefined);
});
