
// Run the original 295 preparation lease before advancing and restoring at 350.
module.exports.withCombinedSignedSettlement350ForRestore = (receipt,prepare295,consume,material) => {
  need(typeof prepare295==='function' && typeof consume==='function' && material && typeof material==='object',
    'BACKUP350_INSTALLER_ARGUMENTS');
  const signed=require('./signed-settlement-350-profile.cjs');
  signed.assertSource(material,require('./multi-witness.cjs').final);
  return withCombinedOrdinaryLoan(receipt,consume,exactMultiWitness295,true,{...readForward320(material,signed.count),prepare295});
};
