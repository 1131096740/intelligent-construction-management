"use strict";
const {withRetainedPayment282}=require("./installer.cjs");
const {load,verifyFacts}=require("./retained-payment.cjs");
const receipt={schemaVersion:1,purpose:"PAYMENT_EXECUTION_ORIGINAL_PAID_MISMATCH_DIAGNOSTIC",status:"STOPPED",stages:[]};
withRetainedPayment282(receipt,async ()=>{
  throw new Error("PAYMENT_RETAINED_NARROW_BOUNDARY");
}).catch(error=>{
  if(error.message==="PAYMENT_RETAINED_PAID_MISMATCH_ONLY_COMPLETED" &&
     receipt.retainedPaymentNegatives?.length===1 &&
     receipt.retainedPaymentNegatives[0].case==="paid_mismatch" &&
     receipt.cleanup==="POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT"){
    receipt.status="PAYMENT_RETAINED_PAID_MISMATCH_ROLLBACK_PASSED";
    return;
  }
  receipt.status="STOPPED";
  receipt.failure={stage:receipt.stages.at(-1)??"INPUTS",code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:"UNCLASSIFIED",exit:error.exit,signal:error.signal};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
