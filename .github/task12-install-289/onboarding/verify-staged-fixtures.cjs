'use strict';
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const assert=require('node:assert/strict');
const [lane,workspace]=process.argv.slice(2);
assert.equal(process.argv.length,4);
const pins=require('./fixture-pin.json').filter(row=>row.lane===lane);
assert.ok(pins.length>0);
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const pin of pins){
  assert.equal(hash(path.join(__dirname,pin.source)),pin.sha256);
  assert.equal(hash(path.join(workspace,pin.target)),pin.sha256);
}
const product=require('./application-source.json');
for(const [file,expected] of Object.entries(product.files)){
  assert.equal(hash(path.join(workspace,file)),expected);
}
console.log(JSON.stringify({lane,exactProductFiles:Object.keys(product.files).length,exactFixtureFiles:pins.length}));
