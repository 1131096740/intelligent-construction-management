
// Keep the original 295 preparation lease before the exact 349 migration and restore.
module.exports.withCombinedExpensePrecisionForRestore = (receipt,prepare295,consume,material) => {
  need(typeof prepare295==='function' && typeof consume==='function' && material && typeof material==='object',
    'BACKUP349_INSTALLER_ARGUMENTS');
  const precision=require('./expense-witness-349-profile.cjs');
  precision.assertSource(material,require('./multi-witness.cjs').final);
  return withCombinedOrdinaryLoan(receipt,consume,exactMultiWitness295,true,{...readForward320(material,precision.count),prepare295});
};
