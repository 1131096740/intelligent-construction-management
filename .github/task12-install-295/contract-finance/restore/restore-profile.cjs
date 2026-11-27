'use strict';
const old=require('./technical-relations.json');
const forward=require('./forward-320-inventory.json');

function profile(count,businessCount,added,extra){
  const emptyBindings=Object.freeze([...old.emptyBindings,...extra]);
  const technical=Object.freeze([old.key,old.operatingVerifier,old.operatingContext,...emptyBindings]);
  return Object.freeze({count,businessCount,emptyBindings,technical,
    addedBusiness:Object.freeze(added),sqlnames:technical.map(name=>"'"+name+"'").join(',')});
}
const legacy=profile(295,356,[],[]);
const successor=profile(329,forward.businessTables,forward.businessAdditions.map(([,name])=>name),
  forward.ownerSchemaOnlyEmptyAdditions.map(([,name])=>name));

// The 330 terminal changes payment columns, constraints and routines only.
const textDirect=Object.freeze({...successor,count:330});
const expense346=profile(346,successor.businessCount+1,[...successor.addedBusiness,'ExpensePublicCashCostLink'],
  [...forward.ownerSchemaOnlyEmptyAdditions.map(([,name])=>name),'jg_expense_public_cash_voucher_witness']);

// The reimbursement precision tail changes columns, constraints and routines on the same tables.
const expense349=Object.freeze({...expense346,count:349});

// The signed settlement tail preserves the business and technical table inventory.
const signed350=Object.freeze({...expense349,count:350});

// Company history adds three business tables; the transfer-return migration adds no table.
const company352=profile(352,signed350.businessCount+3,
  [...signed350.addedBusiness,'CompanyHistoryExpenseBatch','CompanyHistoryExpenseRow','CompanyHistoryExpenseFact'],
  [...forward.ownerSchemaOnlyEmptyAdditions.map(([,name])=>name),'jg_expense_public_cash_voucher_witness']);
module.exports={legacy,successor,textDirect,expense346,expense349,signed350,company352};
