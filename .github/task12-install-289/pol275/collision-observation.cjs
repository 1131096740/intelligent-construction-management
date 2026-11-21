'use strict';

function createObservation() {
  const patterns = {
    prismaP3018:/\bP3018\b/u,
    postgres42501:/\b42501\b/u,
    originalMigration:/\b20260909100000_pol275_clearing_reconciliation_repair\b/u,
  };
  const observations=Object.fromEntries(['stdout','stderr'].map(channel=>[
    channel,Object.fromEntries(Object.keys(patterns).map(marker=>[marker,false]))
  ]));
  function observeChild(child) {
    for(const channel of Object.keys(observations)) {
      let tail='';
      child[channel]?.on('data',chunk=>{
        const value=tail+chunk.toString('utf8');
        for(const [marker,regex] of Object.entries(patterns)) {
          observations[channel][marker] ||= regex.test(value);
        }
        tail=value.slice(-96);
      });
    }
    return child;
  }
  return {observeChild,view:()=>structuredClone(observations)};
}
module.exports={createObservation};
