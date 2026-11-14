'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {filterPaymentDiagnostic}=require('./task16-current259-payment-diagnostics.cjs');
test('server diagnostic is finite and bound to failed registration 500/expected201',()=>{
 const detail={httpStatus:500,expectedHttpStatus:201,serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2010',serverSqlState:'42501'};
 assert.deepEqual(filterPaymentDiagnostic(detail),detail);
 assert.deepEqual(filterPaymentDiagnostic({...detail,httpStatus:200}),{httpStatus:200,expectedHttpStatus:201});
 assert.deepEqual(filterPaymentDiagnostic({...detail,serverErrorKind:'ERROR'}),{httpStatus:500,expectedHttpStatus:201,serverErrorKind:'ERROR'});
 assert.deepEqual(filterPaymentDiagnostic({...detail,serverPrismaCode:'private',serverSqlState:'private'}),{httpStatus:500,expectedHttpStatus:201,serverErrorKind:'KNOWN_REQUEST_ERROR'});
});
test('server diagnostic does not execute getters, proxy traps or retain raw fields',()=>{
 let calls=0;const input={httpStatus:500,expectedHttpStatus:201,message:'private',meta:{code:'42501'}};
 Object.defineProperty(input,'serverErrorKind',{get(){calls++;throw Error('private');}});
 assert.deepEqual(filterPaymentDiagnostic(input),{httpStatus:500,expectedHttpStatus:201});
 assert.deepEqual(filterPaymentDiagnostic(new Proxy(input,{getOwnPropertyDescriptor(){calls++;throw Error('private');}})),{});
 assert.equal(calls,0);
});

test('supported P2004 producer output survives the final receipt projection',()=>{
 assert.deepEqual(filterPaymentDiagnostic({httpStatus:500,expectedHttpStatus:201,serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2004'}),{httpStatus:500,expectedHttpStatus:201,serverErrorKind:'KNOWN_REQUEST_ERROR',serverPrismaCode:'P2004'});
});

const {projectPostLiveFailure}=require('./task16-current259-payment-diagnostics.cjs');
const relayError=(fields={})=>Object.defineProperties(Error('private SQL token'),Object.fromEntries(Object.entries({code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',...fields}).map(([key,value])=>[key,{value}])));
for(const suffix of ['ABORTED','CONFIG','LIMIT','CHILD','STREAM','FRAME','HALF_CLOSE_TIMEOUT','DEPLOY_DRAIN_TIMEOUT','DEPLOY_DRAIN_ACTIVE','LISTEN','CLOSED','CLEANUP'])
 test('post-live projection retains only fixed relay code '+suffix,()=>{
  const relayCode='CURRENT259_LOOPBACK_FORWARD_'+suffix;
  assert.deepEqual(projectPostLiveFailure(relayError({relayCode}), 'POST_LIVE_RESOURCE_CHECK'),{phase:'POST_LIVE_RESOURCE_CHECK',relayCode});
 });
for(const relayFrameStage of ['DATA_AFTER_FIN','OVERSIZED_LENGTH','TRAILING_AFTER_FIN','STDOUT_EOF_WITHOUT_FIN'])
 test('post-live projection retains fixed frame stage '+relayFrameStage,()=>{
  const relayCode='CURRENT259_LOOPBACK_FORWARD_FRAME';assert.deepEqual(projectPostLiveFailure(relayError({relayCode,relayFrameStage}),'POST_LIVE_RESOURCE_CHECK'),{phase:'POST_LIVE_RESOURCE_CHECK',relayCode,relayFrameStage});
 });
for(const relaySysreadExit of [70,71,72,73,74,75])test('post-live projection preserves only reserved sysread '+relaySysreadExit,()=>{
 const fields={relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit};
 assert.deepEqual(projectPostLiveFailure(relayError(fields),'POST_LIVE_RESOURCE_CHECK'),{phase:'POST_LIVE_RESOURCE_CHECK',...fields});
});
for(const relayChildExitCode of [0,41,42,43,44,45,46,47,48])test('post-live child exit remains finite '+relayChildExitCode,()=>{
 const fields={relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode};assert.deepEqual(projectPostLiveFailure(relayError({...fields,relaySysreadExit:99}),'POST_LIVE_RESOURCE_CHECK'),{phase:'POST_LIVE_RESOURCE_CHECK',...fields});
});
test('post-live projection rejects unknown phase, non-native and cross-field combinations',()=>{
 assert.equal(projectPostLiveFailure(relayError(),'PRIVATE_PHASE'),undefined);
 assert.deepEqual(projectPostLiveFailure({code:'TASK01_RESOURCE_LOOPBACK_FORWARD_FAILED',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME'},'POST_LIVE_PLAN_CHECK'),{phase:'POST_LIVE_PLAN_CHECK',relayDiagnosticAbsent:true});
 const error=relayError({relayCode:'CURRENT259_LOOPBACK_FORWARD_CLOSED',relayFrameStage:'STDOUT_EOF_WITHOUT_FIN',relayChildExitCode:47,relaySysreadExit:70,relayCloseState:{secret:'private'}});
 assert.deepEqual(projectPostLiveFailure(error,'POST_LIVE_ATTEMPT_CHECK'),{phase:'POST_LIVE_ATTEMPT_CHECK',relayCode:'CURRENT259_LOOPBACK_FORWARD_CLOSED'});
 const wrong=relayError({relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayFrameStage:'PRIVATE_FRAME',relayChildExitCode:70,relaySysreadExit:70});
 assert.deepEqual(projectPostLiveFailure(wrong,'POST_LIVE_RESOURCE_CHECK'),{phase:'POST_LIVE_RESOURCE_CHECK',relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME'});
});
test('post-live close snapshot is complete immutable own booleans with no retained metadata',()=>{
 const state={hostFin:true,stdinEnded:true,pgFin:false,stdoutEnded:false,cliClosed:true,stdoutRawEnd:true,receiveSettled:false,cliExited:true,peerSocketDestroyed:false,peerEndReturned:false,raw:'private'};
 const result=projectPostLiveFailure(relayError({relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayCloseState:state}),'POST_LIVE_RESOURCE_CHECK');
 assert.equal(Object.keys(result.relayCloseState).length,10);assert.notEqual(result.relayCloseState,state);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.relayCloseState));assert.equal(result.relayCloseState.raw,undefined);
 delete state.hostFin;assert.equal(projectPostLiveFailure(relayError({relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayCloseState:state}),'POST_LIVE_RESOURCE_CHECK').relayCloseState,undefined);
 let reads=0;const proxy=new Proxy(state,{getOwnPropertyDescriptor(){reads++;throw Error('private');}});
 assert.equal(projectPostLiveFailure(relayError({relayCode:'CURRENT259_LOOPBACK_FORWARD_FRAME',relayCloseState:proxy}),'POST_LIVE_RESOURCE_CHECK').relayCloseState,undefined);assert.equal(reads,0);
});
