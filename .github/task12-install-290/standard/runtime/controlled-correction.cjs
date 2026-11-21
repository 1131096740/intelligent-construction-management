'use strict';
const {readApprovalRoundCatalog}=require('./approval-round-catalog.cjs');
async function prepareControlledCorrection(context,receipt){
 if(receipt.before.tableInsert||receipt.before.anyColumnInsert||typeof context.verifyCorrectionReady!=='function')
   throw Error('NTF04_ORIGINAL_ROLE_SCOPE');
 receipt.successor=await context.verifyCorrectionReady();
 const after=await readApprovalRoundCatalog(context,receipt);
 if(JSON.stringify(after)!==JSON.stringify(receipt.before))throw Error('NTF04_APPROVAL_ACL_DRIFT');
}
module.exports={prepareControlledCorrection};
