'use strict';

const {createHash}=require('node:crypto');
const {isExactCurrentArchiveProfile,isExactCurrentPaymentProfile,PAYMENT261_RUNTIME_PROFILE,ARCHIVE262_LEDGER_SHA256}=require('./task16-current259-profile.cjs');

const PAYMENT262_FAULT_RUNTIME_PROFILE='TASK16_PAYMENT262_FAULT_RUNTIME_V1';
const SCHEMA='60386e4f3c54ee25461e8a3814e7254f8d4f5695eb58a805486485cb1cc788e4';

function isExactCurrent262FaultProfile(source){
 return isExactCurrentArchiveProfile(source)&&source.profile==='TASK12_ARCHIVE262_SOURCE_V1'&&
  source.schemaSha256===SCHEMA&&source.ledgerSha256===ARCHIVE262_LEDGER_SHA256&&
  createHash('sha256').update(JSON.stringify(source.ledger)).digest('hex')===source.ledgerSha256;
}

function nativeCommitFaultPaymentProfile(source){
 if(isExactCurrentPaymentProfile(source,PAYMENT261_RUNTIME_PROFILE))return PAYMENT261_RUNTIME_PROFILE;
 if(isExactCurrent262FaultProfile(source))return PAYMENT262_FAULT_RUNTIME_PROFILE;
 throw Object.assign(new Error('TASK16_NATIVE_COMMIT_FAULT_PROFILE'),{code:'TASK16_NATIVE_COMMIT_FAULT_PROFILE'});
}

module.exports=Object.freeze({isExactCurrent262FaultProfile,nativeCommitFaultPaymentProfile,PAYMENT262_FAULT_RUNTIME_PROFILE});
