'use strict';

const {createHash}=require('node:crypto');

const knownSqlStates=new Set([
  '22003','22P02','23502','23503','23505','23514','25P02','28000','40001','40P01',
  '42501','42601','42703','42883','42P01','55000','55P03','57014','P0001',
]);
const knownPrisma=new Set(['P1001','P1017','P2002','P2003','P2010','P2025','P2028','P2034','P2037']);
const knownDenials={
  function:new Set([
    'append_company_transfer_event','authorizeOperatingLedgerWrite','issue_contract_bank_holder',
    'record_verified_bank_observation','assert_fund_execution_server_context',
    'jg_company_transfer_original_source','jg_company_transfer_original_used',
    'jg_company_transfer_original_checkpoints','jg_company_transfer_correction_delta',
    'jg_check_company_transfer_loan_repayment_insert_v1',
    'jg_check_company_transfer_loan_repayment_approval_v1',
    'jg_has_exclusive_file_business_binding','jg_file_business_binding_columns_before_registered_payment','jg_file_business_binding_columns_before_signed_settlement',
    'jg_check_normal_archive_voucher_v1','jg_registered_payment_voucher_bound',
  ]),
  table:new Set([
    'CompanyTransfer','CompanyTransferEvent','CompanyTransferOriginalDebtCorrection','CompanyTransferBankClaim',
    'VerifiedBankTransactionObservation','ContractBankVerificationRequest','ContractBankVerificationDecision',
    'Project','ProjectMember','ProjectParticipatingCompany','ProjectAffiliateCompanyContract','UserPosition','Position',
    'ApprovalInstance','ApprovalActionLog','AuditLog','FileObject','HandwrittenSignatureVersion',
    'OperatingLedgerWriteSecret','FundAccountBalanceRegistration','FundAccountSourceBatch',
    'RegisteredPaymentVoucher','jg_fund_balance_correction_witness_key',
    'jg_company_transfer_loan_repayment_scope_v1','_prisma_migrations',
  ]),
  schema:new Set(['public']),
};
const caseStages=[
  'DATABASE_TARGET_GUARD','COMPANY_TRANSFER_REAL_PG','OUTSIDE_CONTRACT_PROXY_REAL_HTTP',
  'ZERO_COMMITMENT_CORRECTION','CROSS_ENTRY_BANK_CLAIM','DUAL_SIDED_BANK_CLAIM',
  'CONCURRENT_REVIEW','SEPARATE_FINANCE_CONFIRMATION','SIGNED_CONFIRMATION_IMMUTABILITY',
  'SIGNED_FILE_EXCLUSIVITY','ADVISORY_COMPANY_LOCK_ORDER','IN_FLIGHT_FILE_DISCARD',
];
const transferStages=new Set([
  'OWNER_SEED','WRONG_SECRET_DENIALS','UNTRUSTED_ROLE_DENIALS','STORAGE_REQUEST',
  'REQUESTER_APPROVAL_DENIAL','OUTFLOW_BANK_AND_UNAPPROVED_DENIAL','LEADER_APPROVALS',
  'STORAGE_OUTFLOW','STORAGE_INFLOW','STORAGE_RETURN_AND_READBACK','LOAN','REPAYMENT','OWN_FUNDS',
  'OPERATING_FACT_READBACK','HISTORICAL_TIMING','MULTI_REPAYMENT_BOTH_PENDING','MULTI_REPAYMENT_EARLY_DENIED','MULTI_REPAYMENT_DISTINCT_OUTGOING','MIXED_OWNERSHIP','EXITED_PARTICIPANT',
  'SOURCE_REPLAY','AUDIT_READBACK',
]);
const setupStages=new Set([
  'SETUP_LEDGER','SETUP_ROLE','SETUP_TABLE_ACL','SETUP_BANK_GRANT','SETUP_RUNTIME_CONNECTION',
  'SETUP_PRIVILEGE_ASSERT','SETUP_REGISTERED_ALIAS_GRANT',
]);

const outsideRanges=[
  [315,343,'OUTSIDE_OWNER_SEED_AND_HTTP_BOOT'],
  [344,369,'OUTSIDE_BANK_ROLE_AND_CONTEXT'],
  [370,391,'OUTSIDE_BANK_OBSERVATION_AND_DENIALS'],
  [392,413,'OUTSIDE_PROXY_EXECUTION'],
  [415,437,'OUTSIDE_UNMATCHED_RECEIPT'],
  [438,461,'OUTSIDE_UPWARD_SETTLEMENT'],
  [462,492,'OUTSIDE_UPWARD_RECEIPT_MATCHING'],
  [493,504,'OUTSIDE_BANK_REVERSAL'],
  [505,550,'OUTSIDE_DIRECT_BANK_RECEIPT'],
];
const suiteRanges=[
  [68,80],[184,312],[314,553],[555,594],[596,604],[606,624],
  [625,642],[643,655],[656,722],[723,767],[768,812],[813,950],
];

function projectedMessages(messages){
  const sqlstates=new Set(),prisma=new Set(),denials=new Map();
  let unclassifiedDenial=false;
  for(const value of messages){
    if(typeof value!=='string')continue;
    const text=value.slice(0,64*1024).replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu,'');
    for(const match of text.matchAll(/\b(?:SQLSTATE\W*|(?:database error )?code:\s*[`"']?)([0-9A-Z]{5})\b/giu)){
      if(knownSqlStates.has(match[1]))sqlstates.add(match[1]);
    }
    for(const match of text.matchAll(/\bP[0-9]{4}\b/gu)){
      if(knownPrisma.has(match[0]))prisma.add(match[0]);
    }
    for(const match of text.matchAll(/permission denied for (table|relation|function|schema) ([A-Za-z0-9_."]{1,130})/giu)){
      const kind=match[1].toLowerCase()==='relation'?'table':match[1].toLowerCase();
      const object=match[2].replaceAll('"','').replace(/^public\./u,'').replace(/\.$/u,'');
      if(knownDenials[kind].has(object))denials.set(kind+'='+object,{kind,object});
      else unclassifiedDenial=true;
    }
  }
  return {sqlstates:[...sqlstates],prisma:[...prisma],denied:[...denials.values()],unclassifiedDenial};
}

function finiteObservation(rows,allowed){
  const matching=rows.filter(row=>row?.error&&allowed.has(row.stage));
  if(matching.length!==1)return undefined;
  const {stage,error}=matching[0];
  const finiteCodes=(values,known)=>Array.isArray(values)?values.filter(value=>known.has(value)).slice(0,8):[];
  const denials=Array.isArray(error.denied)?error.denied.filter(value=>
    typeof value?.kind==='string'&&Object.hasOwn(knownDenials,value.kind)&&knownDenials[value.kind].has(value.object))
    .slice(0,8).map(({kind,object})=>({kind,object})):[];
  return {stage,sqlstates:finiteCodes(error.sqlstates,knownSqlStates),prisma:finiteCodes(error.prisma,knownPrisma),
    denied:denials,unclassifiedDenial:error.unclassifiedDenial===true};
}

function projectJestFailures(cases,expectedTitles,finiteRows=[]){
  const setup=finiteObservation(finiteRows,setupStages);
  const transfer=finiteObservation(finiteRows,transferStages);
  const result=[];
  for(const entry of cases.filter(row=>row?.status==='failed').slice(0,12)){
    const index=expectedTitles.indexOf(entry.title);
    const messages=Array.isArray(entry.failureMessages)?entry.failureMessages.slice(0,4):[];
    const details=Array.isArray(entry.failureDetails)?entry.failureDetails.slice(0,4):[];
    for(const detail of details){
      messages.push(detail?.message,detail?.stack,detail?.meta?.message);
      for(const code of [detail?.code,detail?.meta?.code,detail?.sqlState,detail?.sqlstate]){
        if(knownSqlStates.has(code)||knownPrisma.has(code))messages.push('Code: '+code);
      }
    }
    const projected=projectedMessages(messages);
    let stage=caseStages[index]??'UNREGISTERED_FAILURE';
    let stageSource='REGISTERED_FIXTURE_CASE';
    const observed=index===1?transfer:undefined;
    if(observed){
      stage=observed.stage;
      stageSource='FIXTURE_CHECKPOINT';
      projected.sqlstates=[...new Set([...observed.sqlstates,...projected.sqlstates])];
      projected.prisma=[...new Set([...observed.prisma,...projected.prisma])];
      projected.denied=[...new Map([...observed.denied,...projected.denied].map(row=>[row.kind+'='+row.object,row])).values()];
      projected.unclassifiedDenial||=observed.unclassifiedDenial;
    }
    const [start,end]=suiteRanges[index]??[0,0];
    const line=messages.filter(text=>typeof text==='string').flatMap(text=>
      [...text.slice(0,64*1024).matchAll(/(?:\/|\\)project-affiliate-company-contract-db\.spec\.ts:(\d{1,4}):\d{1,4}/gu)]
        .map(hit=>Number(hit[1]))).find(value=>value>=start&&value<=end);
    if(index===2&&line){
      const named=outsideRanges.find(([first,last])=>line>=first&&line<=last);
      if(named){stage=named[2];stageSource='FIXTURE_STACK';}
    }
    result.push({test:index>=0?index+1:null,caseId:index>=0?createHash('sha256').update(expectedTitles[index]).digest('hex'):null,
      stage,stageSource,...projected,...(line&&{fixtureLine:line})});
  }
  return {failed:result,...(setup&&{setup})};
}

module.exports={projectJestFailures,projectedMessages};
