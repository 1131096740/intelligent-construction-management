'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const manifest=require('./workspace-inputs.json');
const lanes=require('./lanes.json');
function verify(base='/qualification/workspace',lane=require('./active-lane.json').lane,overlayRoot) {
  assert.equal(manifest.tree,'23b1c98bc15f36e986d17059579e6673315b9be8');
  assert.ok(Object.hasOwn(lanes,lane),'ONBOARDING_290_LANE');
  const rows={...manifest.files,...lanes[lane].fixturePins};
  for(const [file,want] of Object.entries(rows)){
    assert.ok(!path.isAbsolute(file)&&!file.split('/').includes('..'),'ONBOARDING_290_WORKSPACE_PATH');
    const source=path.join(overlayRoot&&Object.hasOwn(lanes[lane].fixturePins,file)?overlayRoot:base,file);
    assert.ok(fs.lstatSync(source).isFile(),'ONBOARDING_290_WORKSPACE_TYPE');
    assert.equal(createHash('sha256').update(fs.readFileSync(source)).digest('hex'),want,'ONBOARDING_290_WORKSPACE_BYTES');
  }
  return {tree:manifest.tree,files:Object.keys(rows).length,lane,fixtureMounts:Object.keys(lanes[lane].fixturePins).length};
}
module.exports={verify};
