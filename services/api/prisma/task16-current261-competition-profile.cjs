'use strict';

const {isExactCurrentPaymentProfile,PAYMENT261_RUNTIME_PROFILE}=require('./task16-current259-profile.cjs');
const {isExactCurrent262FaultProfile,PAYMENT262_FAULT_RUNTIME_PROFILE}=require('./task16-current262-native-fault-profile.cjs');

const PAYMENT261_COMPETITION_RUNTIME_PROFILE='TASK16_PAYMENT261_COMPETITION_RUNTIME_V1';

const PAYMENT261_CASH_RUNTIME_PROFILE='TASK16_PAYMENT261_PUBLIC_CASH_RUNTIME_V1';
const PAYMENT261_VOUCHER_RUNTIME_PROFILE='TASK16_PAYMENT261_VOUCHER_RUNTIME_V1';
const PAYMENT261_VOUCHER_REVOCATION_RUNTIME_PROFILE='TASK16_PAYMENT261_VOUCHER_REVOCATION_RUNTIME_V1';
const PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE='TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1';

function isCurrentPaymentRuntimeMode(paymentProfile,competition){
 return paymentProfile===undefined||(competition===true?[PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_VOUCHER_REVOCATION_RUNTIME_PROFILE,PAYMENT261_CASH_RUNTIME_PROFILE].includes(paymentProfile):
  competition===false&&[PAYMENT261_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE,PAYMENT262_FAULT_RUNTIME_PROFILE].includes(paymentProfile));
}

function isCurrentPaymentVoucherMode(paymentProfile,voucher){
 return paymentProfile===undefined||voucher===([PAYMENT261_VOUCHER_RUNTIME_PROFILE,PAYMENT261_VOUCHER_REVOCATION_RUNTIME_PROFILE].includes(paymentProfile));
}

function isExactCurrentPaymentRuntimeSource(source,paymentProfile){
 if(paymentProfile===PAYMENT262_FAULT_RUNTIME_PROFILE)return isExactCurrent262FaultProfile(source);
 return isExactCurrentPaymentProfile(source,
  paymentProfile!==undefined&&
   (isCurrentPaymentRuntimeMode(paymentProfile,true)||isCurrentPaymentRuntimeMode(paymentProfile,false))
   ?PAYMENT261_RUNTIME_PROFILE:paymentProfile);
}

module.exports=Object.freeze({PAYMENT261_VOUCHER_REVOCATION_RUNTIME_PROFILE,PAYMENT261_CASH_RUNTIME_PROFILE,PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,
 PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE,isCurrentPaymentRuntimeMode,isCurrentPaymentVoucherMode,isExactCurrentPaymentRuntimeSource});
