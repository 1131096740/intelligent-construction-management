'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const outer=JSON.parse(readFileSync(process.argv[2],'utf8').trimEnd().split('\n').at(-1));
const dir=process.argv[3];
const read=name=>JSON.parse(readFileSync(path.join(dir,name),'utf8'));
const terminal=read('receipt-complete.json');
const markers=['receipt.json','receipt-stage2.json'].map(read);
assert.equal(outer.status,'TASK398_BROWSER_COMPLETION_EXACT_290_PASSED');
assert.equal(outer.installOnly290.count,290);
assert.equal(outer.installOnly290.ledgerSha256,'8741d9da09253efb803af9e132b4cde09de0dfef86da7edf952b6c0056a057a5');
assert.deepEqual(outer.postBehavior290,{catalogPreserved:true,keyUnprovisioned:true});
assert.equal(outer.cleanup,'POSTMASTER_STOPPED_TMPFS_REMOVED_BY_CONTAINER_EXIT');
assert.deepEqual(outer.original,{business:1,passed:1,skipped:0,evidenceStatus:terminal.status});
assert.equal(terminal.runId,outer.runId.replaceAll('-',''));
assert.equal(terminal.status,'BROWSER_COMPLETION_CASE_RETURNED_NOT_FULL_ACCEPTANCE');
assert.equal(new Set(terminal.requestKeySha256).size,2);
assert.ok(terminal.requestKeySha256.every(key=>/^[a-f0-9]{64}$/u.test(key)));
for (const [index,marker] of markers.entries()) {
 assert.equal(marker.status,'UNKNOWN_DO_NOT_RETRY');
 assert.equal(marker.candidate,terminal.candidate);
 assert.equal(marker.runId,terminal.runId);
 assert.deepEqual(marker.requestKeySha256,terminal.requestKeySha256.slice(0,index+1));
}
assert.equal(terminal.firstResponseRecovered,true);
assert.equal(terminal.firstResponseRecoveredAfterReload,true);
assert.deepEqual([terminal.before.paid,terminal.after.paid,terminal.final.paid],['0','3000','10000']);
assert.deepEqual(terminal.final.executionWitness.map(witness=>witness.amount),['3000','7000']);
assert.equal(terminal.voucherDownloaded,true);
assert.equal(createHash('sha256').update(readFileSync(path.join(dir,'downloaded-voucher.png'))).digest('hex'),
  '5e3d382db4dd83d59aa5742793ad6b7903409e865c83bcbc54835049f043bc15');
console.log('TASK398_BROWSER_COMPLETION_290_RECEIPTS_VERIFIED');
