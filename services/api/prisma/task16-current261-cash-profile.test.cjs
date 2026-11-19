'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const cash=require('./task16-current261-cash-profile.cjs');
const plan={runtime:{role:'jg_task01_runtime',tables:[{table:'OperatingFact',select:['id'],insert:[],update:[],references:[]}],functions:[]},observer:{role:'jg_task01_observer',tables:[],functions:[]}};
test('cash projection adds only explicit select columns and two service function executions without mutating the baseline',()=>{
 const before=JSON.stringify(plan),result=cash.cashAccessPlan(plan);
 assert.equal(JSON.stringify(plan),before);
 assert.deepEqual(result.runtime.functions,cash.CASH_WRITER_FUNCTIONS);
 for(const role of ['runtime','observer'])for(const row of result[role].tables){assert.deepEqual(row.insert,role==='runtime'&&row.table==='ProjectCloseAggregate'?['createdAt','projectId','revision','updatedAt']:[]);assert.deepEqual(row.update,role==='runtime'&&row.table==='ProjectCloseAggregate'?['updatedAt']:[]);assert.deepEqual(row.references,[]);}
 assert.ok(result.observer.tables.find(row=>row.table==='RegisteredFundAccount').select.includes('companyEntityId'));
 assert.ok(result.runtime.tables.find(row=>row.table==='SettlementArchiveFile').select.includes('confirmedAt'));
});
test('cash profile rejects duplicate grants in its own delta',()=>{
 assert.throws(()=>cash.cashAccessPlan({...plan,runtime:{...plan.runtime,functions:[...cash.CASH_WRITER_FUNCTIONS]}}));
});
test('cash runtime party snapshot read matches the six physically observed columns',()=>{
 const result=cash.cashAccessPlan(plan),row=result.runtime.tables.find(value=>value.table==='ContractPartySnapshot');
 assert.deepEqual(row.select,['businessPartyVersionId','contractVersionId','displayOrder','id','roleKey','snapshot']);
 assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);assert.deepEqual(row.references,[]);
 assert.equal(result.observer.tables.some(value=>value.table==='ContractPartySnapshot'),false);
});
test('cash runtime close aggregate grants only physically observed four-column read and insert',()=>{
 const result=cash.cashAccessPlan(plan),row=result.runtime.tables.find(value=>value.table==='ProjectCloseAggregate');
 assert.ok(row);assert.deepEqual(row.select,['createdAt','projectId','revision','updatedAt']);assert.deepEqual(row.insert,['createdAt','projectId','revision','updatedAt']);assert.deepEqual(row.update,['updatedAt']);assert.deepEqual(row.references,[]);
 assert.equal(result.observer.tables.some(value=>value.table==='ProjectCloseAggregate'),false);
});
test('cash close impact lookup reads only the five observed columns',()=>{
 const result=cash.cashAccessPlan(plan),row=result.runtime.tables.find(value=>value.table==='ProjectCloseImpact');
 assert.ok(row);assert.deepEqual(row.select,['id','projectId','sourceFingerprint','sourceId','sourceType']);
 assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);assert.deepEqual(row.references,[]);
 assert.equal(result.observer.tables.some(value=>value.table==='ProjectCloseImpact'),false);
});

test('cash close stage runtime reads only narrowed query and predicate columns',()=>{
 const result=cash.cashAccessPlan(plan),row=result.runtime.tables.find(value=>value.table==='ProjectCloseStageVersion');
 assert.ok(row);assert.deepEqual(row.select,['amountSnapshot','id','projectId','projectionCutoffAt','projectionFingerprint','projectionReadAt','revision','stageKey','stateSnapshot','status']);
 assert.deepEqual(row.insert,[]);assert.deepEqual(row.update,[]);assert.deepEqual(row.references,[]);
 assert.equal(result.observer.tables.some(value=>value.table==='ProjectCloseStageVersion'),false);
});
