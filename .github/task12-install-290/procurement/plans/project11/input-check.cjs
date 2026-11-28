'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {contract289,verifyMaterialized}=require('./checkout.cjs');

const tree='a1be083076018686dd8afba68c44ff9c75502014';
const image='sha256:6f946164c5eaf8cab0e1c34b2758ca38b820ffa12b9452970141078724ebaebe';
const root='/qualification/procurement289-nodb';
const sha=value=>createHash('sha256').update(value).digest('hex');

function verify(sourceRoot=root, archive='/qualification/product') {
  let count=0;
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'source-inputs.json'),'utf8'));
  if (manifest.tree!==tree || manifest.files.length!==3505 ||
      sha(JSON.stringify(manifest.files))!=='462b00f309543dac67fa6e0d5c5bcb70bcd6d646230416c41f3b3db79f6364e4' ||
      fs.readFileSync(path.join(__dirname,'image.id'),'utf8').trim()!==image) {
    throw Error('PROCUREMENT_289_BUILD_MANIFEST');
  }
  for(const {file,sha256} of manifest.files) {
    const target=path.join(sourceRoot,file);
    if (!fs.lstatSync(target).isFile() || fs.realpathSync(target)!==target ||
        sha(fs.readFileSync(target))!==sha256) throw Error('PROCUREMENT_289_BUILD_SOURCE');
    count++;
  }
  verifyMaterialized(archive,contract289);
  return {tree,count};
}
module.exports={verify};
