// Preserve the original 295 preparation lease before advancing and restoring at 352.
module.exports.withCombinedCompanyHistory352ForRestore = (receipt,prepare295,consume,material) => {
  need(typeof prepare295==='function' && typeof consume==='function' && material && typeof material==='object',
    'BACKUP352_INSTALLER_ARGUMENTS');
  const company=require('./company-history-352-profile.cjs');
  company.assertSource(material,require('./multi-witness.cjs').final);
  return withCombinedOrdinaryLoan(receipt,consume,exactMultiWitness295,true,{...readForward320(material,company.count),prepare295});
};
