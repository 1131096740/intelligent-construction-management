'use strict';
const notice=require('./terminal.cjs');
const payout=require('./payout-terminal.cjs');
const multi=require('./multi-witness.cjs');

async function installNamed295({receipt,folder,enter,deploy,verifyLedger,jsonSql,sql,credentials,ledger,need,equal}) {
  const ledger293=notice.expected(ledger);
  enter('NAMED_INSTALL_293_NOTICE_LOCK');
  notice.stage(folder,'/qualification/terminal.sql');
  await deploy();
  await verifyLedger(ledger293);
  const noticeCatalog=await jsonSql(notice.catalogSql);
  need(notice.exact(noticeCatalog),'NAMED_293_NOTICE_CATALOG');
  receipt.installOnly293={count:ledger293.length,ledgerSha256:notice.ledgerSha256,catalog:noticeCatalog};

  const ledger294=payout.expected(ledger293);
  enter('NAMED_INSTALL_294_ORDINARY_PAYOUT');
  payout.stage(folder);
  await deploy();
  await verifyLedger(ledger294);
  const payoutCatalog=await jsonSql(payout.catalogSql);
  need(payout.valid(payoutCatalog),'NAMED_294_PAYOUT_CATALOG');
  need(equal(await jsonSql(notice.catalogSql),noticeCatalog),'NAMED_294_NOTICE_CONTINUITY');
  receipt.installOnly294={count:ledger294.length,ledgerSha256:payout.ledgerHash(ledger294),catalog:payoutCatalog};

  const before=await jsonSql(multi.catalogSql);
  need(multi.valid(before,false),'NAMED_294_MULTI_WITNESS_PREIMAGE');
  const ledger295=multi.expected(ledger294);
  enter('NAMED_INSTALL_295_MULTI_WITNESS');
  multi.stage(folder);
  await deploy();
  await verifyLedger(ledger295);
  const after=await jsonSql(multi.catalogSql);
  need(multi.valid(after,true),'NAMED_295_MULTI_WITNESS_CATALOG');
  const checkTailCatalogs=async()=>{
    need(equal(await jsonSql(notice.catalogSql),noticeCatalog),'NAMED_295_NOTICE_CONTINUITY');
    need(equal(await jsonSql(payout.catalogSql),payoutCatalog),'NAMED_295_PAYOUT_CONTINUITY');
    need(equal(await jsonSql(multi.catalogSql),after),'NAMED_295_MULTI_WITNESS_CONTINUITY');
  };
  const rollback=await jsonSql(multi.twoRowRollbackSql);
  need(equal(rollback,{twoSameLoanRows:true,duplicateRequestRejected:true}),'NAMED_295_MULTI_WITNESS_ROLLBACK');
  await checkTailCatalogs();

  for (const role of ['runtime','observer']) {
    const denied=await sql('SELECT request_key FROM '+multi.relation+';',{
      extra:{PGUSER:'jg_task01_'+role,PGPASSWORD:credentials[role]},allowFailure:true,
    });
    need(denied.code===3&&denied.scopePermissionDenied===true,'NAMED_295_MULTI_WITNESS_NON_OWNER_DENIAL');
  }
  receipt.installOnly295={count:ledger295.length,ledgerSha256:multi.ledgerHash(ledger295),
    sameIdentity:true,exactB7:true,before,after,rollback,nonOwnerDenied:true};
  return {ledger:ledger295,checkTailCatalogs};
}

module.exports={installNamed295};
