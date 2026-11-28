'use strict';
/** The caller's observers throw unless each immutable graph assertion passes. */
async function runLedgerLossFlow({lose,observeCommitted,readOriginal,authorizeReplay,replay,observeReplay}){
 const proof=await lose();if(proof?.faultState!=='dropped'||proof.upstreamStatusCode!==201)throw new Error('PG_LEDGER_LOSS_BOUNDARY');
 await observeCommitted();await readOriginal();await authorizeReplay();await replay();await observeReplay();
}
module.exports={runLedgerLossFlow};
