"use strict";
const {spawnSync}=require("node:child_process");
const fs=require("node:fs");
const requirements=require("./task16-current259-voucher-acl.requirements.json");
const tables=[...new Set([...Object.keys(requirements.readDelta),"User","ApprovalInstance","PaymentRequest","RegisteredPaymentVoucher"])].sort();
const functions=[...new Set([...requirements.routineSources.map(row=>/^public\.(?:"([A-Za-z0-9_]+)"|([A-Za-z0-9_]+))\(/u.exec(row.signature)?.slice(1).find(Boolean)).filter(Boolean),"jg_has_exclusive_file_business_binding","jg_enforce_exclusive_file_business_binding","jg_enforce_file_replacement_exclusive_binding"])].sort();
function classify(before,after){
 if(typeof before!=="string"||typeof after!=="string"||!after.startsWith(before)||!before.endsWith("\n"))return "UNKNOWN";
 const delta=after.slice(before.length);
 if(delta && !delta.endsWith("\n"))return "UNKNOWN";
 const records=delta.split("\n").filter(line=>line.startsWith("JG398|jg398_runtime|jiangkong_payment_execution_concurrency|"));
 if(records.length!==1)return "UNKNOWN";
 const m=/^JG398\|jg398_runtime\|jiangkong_payment_execution_concurrency\|[1-9][0-9]{0,9}\|42501\|ERROR:  permission denied for (table|relation|function|schema|sequence) (?:public\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?$/u.exec(records[0]);
 if(!m)return "UNKNOWN";
 const [kind,name]=m.slice(1),index=(kind==="table"||kind==="relation"?tables:kind==="function"?functions:[]).indexOf(name);
 if(kind==="schema"&&name==="public")return "SCHEMA_PUBLIC";
 return index<0?"UNKNOWN":`${kind==="function"?"FUNCTION":"TABLE"}_${String(index+1).padStart(3,"0")}`;
}
function capture(env){
 if(!/^unix:\/\//u.test(env.TASK398_LOG_ENDPOINT??"")||!/^[a-f0-9]{64}$/u.test(env.TASK398_LOG_CONTAINER??"")||!env.TASK398_LOG_FILE)return null;
 try{const result=spawnSync("docker",["--host",env.TASK398_LOG_ENDPOINT,"logs",env.TASK398_LOG_CONTAINER],{encoding:"utf8",maxBuffer:4*1024*1024,timeout:10000});
 return result.status===0&&!result.error?result.stderr:null;}catch{return null;}
}
function finish(before,after,env){
 try{
  if(typeof before!=="string"||typeof after!=="string"||!after.startsWith(before))return "UNKNOWN";
  fs.writeFileSync(env.TASK398_LOG_FILE,after.slice(before.length),{mode:0o600,flag:"wx"});
  return classify(before,after);
 }catch{return "UNKNOWN";}
}
module.exports={capture,classify,finish};
