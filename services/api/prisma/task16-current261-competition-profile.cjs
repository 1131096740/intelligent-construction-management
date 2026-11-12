'use strict';

const {isExactCurrentPaymentProfile,PAYMENT261_RUNTIME_PROFILE}=require('./task16-current259-profile.cjs');

const PAYMENT261_COMPETITION_RUNTIME_PROFILE='TASK16_PAYMENT261_COMPETITION_RUNTIME_V1';

const PAYMENT261_VOUCHER_RUNTIME_PROFILE='TASK16_PAYMENT261_VOUCHER_RUNTIME_V1';
const PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE='TASK16_PAYMENT261_ATTRIBUTION_GAP_RUNTIME_V1';

function isCurrentPaymentRuntimeMode(paymentProfile,competition){
 return paymentProfile===undefined||(competition===true?[PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE].includes(paymentProfile):
  competition===false&&[PAYMENT261_RUNTIME_PROFILE,PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE].includes(paymentProfile));
}

function isCurrentPaymentVoucherMode(paymentProfile,voucher){
 return paymentProfile===undefined||voucher===(paymentProfile===PAYMENT261_VOUCHER_RUNTIME_PROFILE);
}

function isExactCurrentPaymentRuntimeSource(source,paymentProfile){
 return isExactCurrentPaymentProfile(source,
  paymentProfile!==undefined&&
   (isCurrentPaymentRuntimeMode(paymentProfile,true)||isCurrentPaymentRuntimeMode(paymentProfile,false))
   ?PAYMENT261_RUNTIME_PROFILE:paymentProfile);
}

module.exports=Object.freeze({PAYMENT261_COMPETITION_RUNTIME_PROFILE,PAYMENT261_VOUCHER_RUNTIME_PROFILE,
 PAYMENT261_ATTRIBUTION_GAP_RUNTIME_PROFILE,isCurrentPaymentRuntimeMode,isCurrentPaymentVoucherMode,isExactCurrentPaymentRuntimeSource});
