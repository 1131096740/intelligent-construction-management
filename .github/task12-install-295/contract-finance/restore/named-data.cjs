'use strict';

const assert = require('node:assert/strict');
const {technical} = require('./archive-contract.cjs');
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;

function dataOnlyList(toc, expectedTables, expectedSequences) {
  const entries = [];
  for (const line of toc.split(/\r?\n/u)) {
    if (!/^\d+; \d+ \d+ (?:TABLE DATA|SEQUENCE SET)\b/u.test(line)) continue;
    const row = /^(\d{1,6}); \d+ \d+ (TABLE DATA|SEQUENCE SET) public ([A-Za-z_][A-Za-z0-9_]{0,62}) [A-Za-z_][A-Za-z0-9_]{0,62}$/u.exec(line);
    assert.ok(row, 'BACKUP292_DATA_ENTRY_SCOPE');
    assert.ok(!technical.includes(row[3]), 'BACKUP292_TECHNICAL_DATA_ENTRY');
    entries.push({line, id:Number(row[1]), kind:row[2], name:row[3]});
  }
  assert.equal(new Set(entries.map(row=>row.id)).size, entries.length,'BACKUP292_DUPLICATE_DATA_ENTRY');
  for (const [kind, expected] of [['TABLE DATA', expectedTables],['SEQUENCE SET', expectedSequences]]) {
    assert.ok(expected.every(name=>identifier.test(name)), 'BACKUP292_DATA_CATALOG_NAMES');
    assert.deepEqual(entries.filter(row=>row.kind===kind).map(row=>row.name).sort(),[...expected].sort(),
      'BACKUP292_DATA_TOC_SCOPE');
  }
  return entries.map(row=>row.line).join('\n')+'\n';
}

function namedDataArgs(restoreDb,file,list) {
  assert.equal(restoreDb,'contract_restored');
  return ['--dbname',restoreDb,'--exit-on-error','--single-transaction',
    '--data-only','--no-owner','--no-privileges','--use-list',list,file];
}
module.exports={dataOnlyList,namedDataArgs};
