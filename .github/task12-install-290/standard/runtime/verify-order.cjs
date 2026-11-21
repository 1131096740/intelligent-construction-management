'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,file),'utf8');
function ensureOrder(source,segments){
 let end=0;
 for (const segment of segments){
  const at=source.indexOf(segment,end);
  assert.ok(at>=end,segment);
  end=at+segment.length;
 }
}
const installer=read('installer.cjs');
const callback=read('controlled-correction.cjs');
const business=read('services/api/prisma/run-task398-shared-standard-local.cjs');
ensureOrder(installer,[
 "enter('FINAL_UPWARD_WITNESS')",
 "enter('INSTALL_ONLY_290_FORWARD')",
 "enter('CORRECTION_290_LEDGER_READBACK')",
 "enter('CORRECTION_290_B7_READBACK')",
 "enter('CORRECTION_290_OUTSIDE_READBACK')",
 "enter('CORRECTION_290_ACL_READBACK')",
 "if(purpose===installOnly290||purpose===correction290) await deploy290();",
 "verifyCorrectionReady: async()=>",
 "enter('CORRECTION_290_PRE_APP_CATALOG')",
 "need(successor.exactCatalog(shape),'CORRECTION_290_PRE_APP_CATALOG')",
 "await consume(context);",
 "'CONSUMER_PROTECTED_CATALOG_CONTINUITY'",
 "need(correctionApplicationAdmitted,'CORRECTION_290_APPLICATION_NOT_ADMITTED')",
 "'CORRECTION_290_FINAL_CATALOG'",
]);
assert.equal((installer.match(/await deploy290\(\)/gu)||[]).length,2);
ensureOrder(callback,["receipt.before.tableInsert","context.verifyCorrectionReady()","await readApprovalRoundCatalog(context,receipt)"]);
ensureOrder(business,["businessReadGrantSql(advanceExcludedReads,current280)","await prepareControlledCorrection(context,receipt)","env.RUN_TASK419_CONTROLLED_ROUND"]);
ensureOrder(business,["(mode===\"correction-catalog\"||mode===\"standard-290\")?290:282","await snapshotOwned280CashProfile(sql,fences)","await runBusiness(options,{candidate,short,storage,url,sql,env,current280:true","await closeOwned280CashProfile(sql,protectedExec,fences)"]);
ensureOrder(installer,["enter('FINAL_UPWARD_WITNESS')","if(purpose===standard290) await deploy290();","await consume(context);","'CONSUMER_PROTECTED_CATALOG_CONTINUITY'","enter('STANDARD_290_POST_CONSUMER')","'STANDARD_290_FINAL_CATALOG'"]);
ensureOrder(business,["const knownTitle=","const selection=standard290?",'numPassedTests!==8','standard290.original={business:1,passed:8,skipped:0}']);
console.log('EXACT_290_OFFLINE_ORDER_AND_ORIGINAL_TEARDOWN');
