"use strict";
const {withRetainedPayment282}=require("./installer.cjs");
const {load,verifyFacts}=require("./retained-payment.cjs");
const receipt={schemaVersion:1,purpose:"PAYMENT_EXECUTION_ORIGINAL_REMAINING_13_NEGATIVES",status:"STOPPED",stages:[]};
withRetainedPayment282(receipt,async ()=>{
  throw new Error("PAYMENT_RETAINED_NARROW_BOUNDARY");
}).catch(error=>{
  if(error.message==="PAYMENT_RETAINED_OTHER_NEGATIVES_COMPLETED" &&
     receipt.retainedPaymentNegatives?.length===13 &&
     JSON.stringify(receipt.retainedPaymentNegatives.map(row=>row.case))===
       JSON.stringify(load("/qualification/retained-payment.json").cases.slice(2).map(row=>row.label)) &&
     receipt.cleanup==="POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT"){
    receipt.status="PAYMENT_RETAINED_OTHER_13_NEGATIVES_PASSED";
    return;
  }
  receipt.status="STOPPED";
  receipt.failure={stage:receipt.stages.at(-1)??"INPUTS",code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:"UNCLASSIFIED",exit:error.exit,signal:error.signal};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
