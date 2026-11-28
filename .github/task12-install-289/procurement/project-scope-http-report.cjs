'use strict';

const allowed = new Set(['PROJECT_CREATE','CONTRACT_CREATE','CONTRACT_APPROVAL','PAYMENT_CREATE','PAYMENT_APPROVAL',
  'PAYMENT_DETAIL','SPOT_PAYMENT_APPROVAL','EXPENSE_CREATE','EXPENSE_APPROVAL','PROCUREMENT_CREATE','PROCUREMENT_ARCHIVE',
  'SETTLEMENT','OTHER_ORIGINAL_HTTP']);
const status = value => Number.isInteger(value) && value >= 100 && value <= 599;
const strictList = (values,pattern) => Array.isArray(values) && values.length<=4 &&
  new Set(values).size===values.length && values.every(value=>typeof value==='string'&&pattern.test(value));

function readProjectHttpObservation(assertion) {
  const hits=[...assertion.matchAll(/PROJECT_SCOPE_HTTP_OBSERVATION (\{[^\n\r]{1,300}\})/gu)];
  if(hits.length!==1) return undefined;
  try {
    const x=JSON.parse(hits[0][1]);
    if(!allowed.has(x.routeClass)||!status(x.expected)||!status(x.actual)||x.expected===x.actual||
      !strictList(x.sqlstates,/^[A-Z0-9]{5}$/u)||!strictList(x.prismaCodes,/^P[0-9]{4}$/u)||
      !strictList(x.transactionKinds,/^(?:START_WAIT|QUERY_EXPIRED|COMMIT_EXPIRED|EXPIRED_OTHER|CLOSED|OTHER)$/u))return undefined;
    return {routeClass:x.routeClass,expected:x.expected,actual:x.actual,sqlstates:x.sqlstates,prismaCodes:x.prismaCodes,transactionKinds:x.transactionKinds};
  } catch { return undefined; }
}
module.exports = { readProjectHttpObservation };
