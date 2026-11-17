'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
test('the response-loss purpose binds its actual transport and business interfaces',()=>{
 const api=require('./run-task16-native-response-loss-once.cjs');
 const interfaces=api.inspectNativeTask16Interfaces();
 const names=interfaces.flatMap(item=>item.exports.map(entry=>entry.name));
 assert.ok(names.includes('createNativeResponseLossTransport'));
 assert.ok(names.includes('runRegisteredNullCrossCompanyNativeResponseLoss'));
 const source=fs.readFileSync(require.resolve('./run-task16-native-response-loss-once.cjs'),'utf8');
 assert.match(source,/PURPOSE='TASK16_NATIVE_RESPONSE_LOSS_V1'/u);
 assert.match(source,/requestJson:undefined/u);
});
