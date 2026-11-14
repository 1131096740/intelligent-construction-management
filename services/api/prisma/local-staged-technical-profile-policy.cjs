"use strict";
// Source-only finite SQL profile policy; it never issues an owned token.
const {createHash}=require('node:crypto');
const ID='CURRENT259_OWNED_TECHNICAL_V1',OWNER='jg_task01_owner';
const ciDatabases=Object.freeze({
 DYNAMIC_PAYMENT_EXECUTION_V1:Object.freeze(['jiangkong_payment_execution_concurrency','jiangkong_payment_execution_retained_valid']),
 DYNAMIC_CONTRACT_TEMPLATE_SCENARIO_V1:Object.freeze(['jiangkong_contract_template_scenario_concurrency']),
 DYNAMIC_CONTRACT_SETTLEMENT_V2:Object.freeze(['jiangkong_contract_bill_batch_test']),
 DYNAMIC_SETTLEMENT_DRAFT_LIFECYCLE_V1:Object.freeze(['jiangkong_settlement_draft_lifecycle_concurrency']),
 DYNAMIC_EMPLOYEE_ONBOARDING_V1:Object.freeze(['onboarding']),
 DYNAMIC_GENERAL_PROCUREMENT_V1:Object.freeze(['general_procurement']),
 DYNAMIC_PROJECT_BUSINESS_SCOPE_V1:Object.freeze(['project_business_scope']),
 DYNAMIC_POL108_V1:Object.freeze(['jiangkong_pol108']),
 DYNAMIC_POL109_V1:Object.freeze(['jiangkong_pol109']),
 DYNAMIC_POL279_V1:Object.freeze(['jiangkong_pol279']),
 DYNAMIC_POL280_V1:Object.freeze(['jiangkong_pol280']),
 DYNAMIC_INVOICE_LEDGER_POL260_V1:Object.freeze(['jiangkong_invoice_ledger_pol260']),
 DYNAMIC_FUND_EXECUTION_V7_V1:Object.freeze(['jgzg_fund_execution_v7']),
 DYNAMIC_POL275_V1:Object.freeze(['jiangkong_pol275','jiangkong_pol275_empty']),
 DYNAMIC_CONTRACT_CLASSIFICATION_V1:Object.freeze(['jiangkong_project_affiliate_company_contract_test','jiangkong_pol114',
  'jiangkong_payment_execution_concurrency']),
 DYNAMIC_POL113_POL115_ENTRY_V1:Object.freeze(['pol113','jiangkong_pol115_entry_test','jiangkong_pol114',
  'jiangkong_pol115_spot_entry_test','template_workbench']),
 DYNAMIC_REMAINING_V1:Object.freeze([
  'jiangkong_contract_draft_aggregate_test','jiangkong_contract_cleanup_pre_m206_test','jiangkong_project_funding_integration_test','jiangkong_contract_takeover_task1_20260729',
  'jiangkong_project_affiliate_company_contract_test','jiangkong_spot_incidental_task11','jiangkong_direct_payment_task13',
  'jiangkong_contract_takeover_task8_final_20260729','jiangkong_file_binding_manifest_test',
  'jiangkong_project_operating_profile_upgrade_test','jiangkong_database_dynamic_misc','jiangkong_participant_history_integrity_test',
  'jiangkong_payable_settlement_dynamic_test','jiangkong_wage_statement_dynamic_test','jiangkong_historical_wage_takeover_dynamic_test',
  'jiangkong_historical_financial_takeover_dynamic_test','jiangkong_fund_movement_dynamic_test'
 ]),
 DYNAMIC_PROJECT_EXPENSE_EXECUTION_V1:Object.freeze(['jiangkong_project_expense_execution_concurrency',
  'jiangkong_project_expense_execution_retained_valid','jiangkong_project_expense_execution_retained_audit_missing']),
 DYNAMIC_PROJECT_EXPENSE_FINANCE_V1:Object.freeze(['jiangkong_project_expense_finance_concurrency',
  'jiangkong_project_expense_finance_retained_valid','jiangkong_project_expense_finance_retained_audit_missing']),
 DYNAMIC_PROJECT_EXPENSE_RECEIPT_V1:Object.freeze(['jiangkong_project_expense_receipt_concurrency',
  'jiangkong_project_expense_receipt_retained_valid'])
});
function isCiDynamicDatabase(profile,database){
 return typeof profile==='string'&&Object.hasOwn(ciDatabases,profile)&&ciDatabases[profile].includes(database);
}
function ciDynamicRecoveryMigration(profile,database){
 if(profile==='DYNAMIC_PROJECT_EXPENSE_EXECUTION_V1'&&database==='jiangkong_project_expense_execution_retained_audit_missing')
  return '20260728140000_project_expense_execution_idempotency';
 if(profile==='DYNAMIC_PROJECT_EXPENSE_FINANCE_V1'&&database==='jiangkong_project_expense_finance_retained_audit_missing')
  return '20260728150000_project_expense_finance_idempotency';
}
const need=ok=>{if(!ok)throw new Error('CURRENT259_TECHNICAL_PROFILE');};
const hash=x=>createHash('sha256').update(x).digest('hex');
function planProfile(plan){
 if(!Object.hasOwn(plan,'technicalProfile')){need(!Object.hasOwn(plan,'resourceRunId'));return null;}
 need(!Object.hasOwn(plan,'ciFixture')&&plan.technicalProfile===ID&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(plan.resourceRunId)&&
  plan.database==='jg_task01_'+plan.resourceRunId.replaceAll('-','')&&plan.actorOid==='10'&&plan.ownerOid==='10');
 return Object.freeze({owner:OWNER,id:ID});
}
// Finite transformations of technical fixtures, never of product migrations.
function projectTechnicalSql(plan,sql,kind){
 const technical=planProfile(plan),ci=Object.hasOwn(plan,'ciFixture');
 const beforeSha256=hash(sql);
 if(ci){
  need(isCiDynamicDatabase(plan.ciFixture,plan.database)&&(kind==='setup'||kind==='post213'));
  if(kind==='post213'){
   const before="'^jiangkong_project_financing_quota_[a-z0-9_]+$'";
   need(sql.split(before).length===3);
   sql=sql.split(before).join("'^"+plan.database+"$'");
  }
  return {sql,beforeSha256,afterSha256:hash(sql)};
 }
 if(!technical)return {sql,beforeSha256,afterSha256:beforeSha256};
 const replacements={
  setup:[["'jiangkong'","'jg_task01_owner'",3],['AUTHORIZATION jiangkong;','AUTHORIZATION jg_task01_owner;',1]],
  post213:[["'^jiangkong_project_financing_quota_[a-z0-9_]+$'","'^jg_task01_[a-f0-9]{32}$'",2],["'jiangkong'","'jg_task01_owner'",1]]
 }[kind];
 need(replacements&&typeof sql==='string');
 for(const [before,after,count] of replacements){need(sql.split(before).length===count+1);sql=sql.split(before).join(after);}
 return Object.freeze({sql,beforeSha256,afterSha256:hash(sql)});
}
module.exports={planProfile,projectTechnicalSql,isCiDynamicDatabase,ciDynamicRecoveryMigration};
