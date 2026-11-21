"use strict";
const {createHash}=require("node:crypto");
const {readFileSync}=require("node:fs");
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(condition,code)=>{if(!condition)throw new Error(code);};
const migration="20260728139000_payment_execution_idempotency";
const checksum="e95d42ff64463872ab135552f64450b81d83a63cde1d900cbc5644fa54841522";
const expectedFacts=[
  "legacy:payment_execution:retained_valid_execution|retained_valid_company|存量迁移验收建设有限公司|91310000RETAINED01|retained_valid_executor|retained_valid_executor",
  "effective|400",
];
function load(file) {
  const bytes=readFileSync(file);
  need(createHash("sha256").update(bytes).digest("hex")==="65abe64ccd8d0d3f2a169d783317930514a5200855c0f8a92d5d540dfe1a6d80","PAYMENT_RETAINED_MATERIAL");
  const data=JSON.parse(bytes);
  need(data.cases.length===15 && data.cases[0].label==="valid" &&
    data.cases.slice(1).every(row=>/^jiangkong_payment_execution_retained_[a-z_]+$/u.test(row.database) &&
      /^payment_execution_[a-z_]+$/u.test(row.expectedMarker)),"PAYMENT_RETAINED_FORMAT");
  return data;
}
async function verifyFacts(data,sql) {
  for(const [i,statement] of data.checks.entries()){
    need((await sql(statement)).stdout.trim()===expectedFacts[i],"PAYMENT_RETAINED_VALID_FACTS");
  }
  return {historicalSettlement:true,exactExecutionCompanyAndUploader:true};
}
async function verifyPrefix({data,database,deploy,sql,jsonSql,inspect,ledger,identity,onPhase}) {
  need(ledger[109]?.name===migration && ledger[109].sha256===checksum,"PAYMENT_RETAINED_MIGRATION_IDENTITY");
  await deploy(109,database);
  const prefix=await jsonSql(inspect);
  const before=identity(prefix);
  need(equal(prefix.ledger,ledger.slice(0,109)),"PAYMENT_RETAINED_PREFIX_LEDGER");
  onPhase("PAYMENT_RETAINED_VALID_SEED");
  await sql(data.cases[0].sql);
  await deploy(110,database);
  const valid=await jsonSql(inspect);
  need(equal(valid.ledger,ledger.slice(0,110)) && equal(identity(valid),before),"PAYMENT_RETAINED_VALID_CONTINUITY");
  const facts=await verifyFacts(data,sql);
  return {identity:before,facts};
}
module.exports={load,verifyFacts,verifyPrefix};
