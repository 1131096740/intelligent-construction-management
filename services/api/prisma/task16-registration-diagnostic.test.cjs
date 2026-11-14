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
