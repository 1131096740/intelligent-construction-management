'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const outer=read(process.argv[2]);
const evidence=read(join(process.argv[3],'receipt.json'));
const count=Number(process.argv[4]??295);
assert.ok([295,329,330,331,332,334].includes(count));
assert.equal(outer.status,'TASK398_BROWSER_PARTIAL_EXACT_'+count+'_PASSED');
if(count!==295){
  assert.equal(outer.forward320?.count,count);
  assert.equal(outer.forward320?.sameIdentity,true);
  assert.equal(outer.forward320?.sameBaseB7,true);
  assert.match(outer.forward320?.sourceTree??'',/^[a-f0-9]{40}$/u);
  assert.match(outer.forward320?.ledgerSha256??'',/^[a-f0-9]{64}$/u);
  assert.equal(outer.combinedAfterBusiness?.count,count);
  assert.equal(outer.combinedAfterBusiness?.ledgerSha256,outer.forward320.ledgerSha256);
  assert.equal(outer.combinedAfterBusiness?.exactB7,true);
  if(count>=330){
    assert.equal(outer.textDirectPredecessor?.count,329);
    assert.equal(outer.textDirectPredecessor?.sameIdentity,true);
    assert.equal(outer.textDirectPredecessor?.sameBaseB7,true);
  }
  if(count>=331){
    assert.deepEqual(outer.paymentRemainderPredecessor,{
      count:330,ledgerSha256:'12a3ffa7cae1b9a54294ebaf38f71788ff4ccb2670a8d539148c84597b5aa99f',
      sameIdentity:true,sameBaseB7:true
    });
    if(count===331) assert.equal(outer.forward320.ledgerSha256,'0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014');
  }
  if(count>=332){
    assert.deepEqual(outer.upwardArchivePredecessor,{
      count:331,ledgerSha256:'0ad8b165cbf5c974596c4da840ab327e438ef84fd1beb3788ef980c8f28dd014',
      sameIdentity:true,sameBaseB7:true
    });
    if(count===332) assert.equal(outer.forward320.ledgerSha256,'b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4');
  }
  if(count===334){
    const {count:preimageCount,ledgerSha256,sameIdentity,sameBaseB7}=outer.historicalTakeoverPredecessor;
    assert.deepEqual({count:preimageCount,ledgerSha256,sameIdentity,sameBaseB7},{
      count:332,ledgerSha256:'b9cd72d795d2ae6d9d61f038c8c89b2391375bc5fdc56337c9dab6d3a18858f4',
      sameIdentity:true,sameBaseB7:true
    });
    assert.equal(outer.historicalSettlementPredecessor.count,333);
    assert.equal(outer.historicalSettlementPredecessor.ledgerSha256,'a00af648da634cce25c27c796171ca21cfa93d17679bfd8176f961b45ecf4fca');
    assert.equal(outer.forward320.ledgerSha256,'27f3af946003d07582efb288b443362fcf61bed0281feb548f9978b739fb5411');
    assert.equal(outer.combinedAfterBusiness.sameIdentity,true);
    assert.equal(outer.historicalTakeoverCatalogAfterBusiness,true);
    assert.equal(outer.historicalSettlementCatalogAfterBusiness,true);
  }
}
assert.equal(evidence.status,'BROWSER_PARTIAL_CASE_RETURNED_NOT_FULL_ACCEPTANCE');
assert.equal(evidence.candidate,outer.sourceSha);
assert.equal(evidence.runId,outer.runId.replaceAll('-',''));
assert.match(evidence.requestKeySha256,/^[a-f0-9]{64}$/u);
assert.equal(outer.installOnly295.ledgerSha256,'b0d398a46c4c6a3209e1448ddd415938ea95425c3d823f1f8a77d81dde396f2d');
console.log('TASK398_BROWSER_PARTIAL_'+count+'_RECEIPTS_VERIFIED');
