'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {assertRestoredCatalog}=require('./exact-349.cjs');

function catalog(oid){
  return {
    columns:{requestedAmountYuan:{type:'numeric(24,4)',nullable:true,plain:true}},
    constraints:{guard:{oid,digest:'a'.repeat(64)}},
    guards:{cash:{
      body:'b'.repeat(64),
      procedure:{oid,pronamespace:2200,proowner:10,prosecdef:false,proacl:['owner=X/owner']},
      wiring:{oid:oid+1,tgrelid:oid+2,tgfoid:oid,tgconstraint:oid+3,tgenabled:'O',tgdeferrable:true,tginitdeferred:true,tgqual:'(OID '+oid+')'},
      definition:'CREATE CONSTRAINT TRIGGER cash AFTER INSERT ON public.cost DEFERRABLE INITIALLY DEFERRED',
    }},
    expectedCostValidatorAfter348:null,
  };
}

test('restored precision protections retain definitions and ACLs across new database OIDs',()=>{
  const source=catalog(10000), restored=catalog(20000);
  source.guards.cash.procedure.proacl.push('runtime=X/owner');
  restored.guards.cash.procedure.proacl.unshift('runtime=X/owner');
  restored.guards.cash.wiring.tgconstraint=String(restored.guards.cash.wiring.tgconstraint);
  assert.doesNotThrow(()=>assertRestoredCatalog(source,restored));
});

test('restored precision protections reject changed column, constraint, body, ACL or trigger wiring',()=>{
  const source=catalog(10000);
  for(const mutate of [
    row=>{row.columns.requestedAmountYuan.type='numeric(24,2)';},
    row=>{row.constraints.guard.digest='c'.repeat(64);},
    row=>{row.guards.cash.body='d'.repeat(64);},
    row=>{row.guards.cash.procedure.proacl=['=X/owner'];},
    row=>{row.guards.cash.wiring.tgdeferrable=false;},
    row=>{row.guards.cash.wiring.tgconstraint='0';},
    row=>{row.guards.cash.definition+=' WHEN (false)';},
  ]){
    const restored=catalog(20000);
    mutate(restored);
    assert.throws(()=>assertRestoredCatalog(source,restored),{code:'ERR_ASSERTION'});
  }
});
