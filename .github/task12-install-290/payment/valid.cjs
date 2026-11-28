"use strict";
const {withPayment290}=require("./installer.cjs");
const {load,verifyFacts}=require("./retained-payment.cjs");
const receipt={schemaVersion:1,purpose:"PAYMENT_EXECUTION_ORIGINAL_RETAINED_VALID_290",status:"STOPPED",stages:[]};
withPayment290(receipt,async context=>{
  if(context.candidateTree!=="a1be083076018686dd8afba68c44ff9c75502014" ||
     context.database!==receipt.retainedPayment?.identity.database)throw new Error("PAYMENT_RETAINED_FINAL_CONTEXT");
  receipt.retainedPayment.at290=await verifyFacts(load("/qualification/retained-payment.json"),context.sql);
}).then(()=>{receipt.status="PAYMENT_EXECUTION_RETAINED_VALID_290_PASSED";}).catch(error=>{
  receipt.status="STOPPED";
  receipt.failure={stage:receipt.stages.at(-1)??"INPUTS",code:/^[A-Z0-9_]+$/u.test(error.message)?error.message:"UNCLASSIFIED",exit:error.exit,signal:error.signal};
  process.exitCode=1;
}).finally(()=>console.log(JSON.stringify(receipt)));
