'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('the fixed audit fault material names only one bound version and projects only two unique catalog nodes',()=>{
 const api=require('./task12-current261-local-lifecycle-fault.cjs'),version='12345678-1234-4234-8234-123456789012';
 const material=api.describeCurrent261LocalLifecycleAuditFault(version);
 assert.equal(material.executionAllowed,false);assert.equal(material.ownerOid,'10');
 assert.ok(material.body.includes(version));assert.ok(material.body.includes("NEW.action='contract.archive.complete'"));
 assert.ok(!material.body.includes('SECURITY DEFINER'));
 for(const field of ['f.procost=100','f.prorows=0','f.probin IS NULL','f.prosqlbody IS NULL','f.proargdefaults IS NULL','t.tgconstrindid=0',"t.tgargs=''::bytea","t.tgattr=''::int2vector"])assert.ok(material.metadataSql.includes(field));
 const original="SELECT (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace=pg_catalog.to_regnamespace('public')),(SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace=pg_catalog.to_regnamespace('public'))";
 const restored=api.restoreCurrent261LocalLifecycleFaultCatalog(original,material);
 assert.ok(restored.includes('p.oid IS DISTINCT FROM'));
 assert.ok(restored.includes('t.oid IS DISTINCT FROM'));
 assert.ok(restored.includes('jg_task12_local_lifecycle_audit_failure'));
 assert.throws(()=>api.restoreCurrent261LocalLifecycleFaultCatalog(original,{...material}),/FAULT_SOURCE/u);
 assert.throws(()=>api.restoreCurrent261LocalLifecycleFaultCatalog(original+' UNION '+original,material),/FAULT_SOURCE/u);
 assert.throws(()=>api.describeCurrent261LocalLifecycleAuditFault(version,"attacker override"),/FAULT_SOURCE/u);
 assert.throws(()=>api.describeCurrent261LocalLifecycleAuditFault("' OR true --"),/FAULT_SOURCE/u);
});
