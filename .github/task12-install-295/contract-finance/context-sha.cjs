'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const [root,dockerfile,source]=process.argv.slice(2);
assert.equal(process.argv.length,5);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=[];
function visit(dir){
  for (const name of fs.readdirSync(path.join(root,dir)).sort()) {
    const rel=path.join(dir,name);
    const file=path.join(root,rel);
    const entry=fs.lstatSync(file);
    if(entry.isDirectory())visit(rel);
    else if(entry.isSymbolicLink())rows.push([rel,'link',fs.readlinkSync(file)]);
    else {
      assert.equal(entry.isFile(),true);
      rows.push([rel,entry.mode&0o111,hash(fs.readFileSync(file))]);
    }
  }
}
visit('');
console.log(hash(JSON.stringify([rows,hash(fs.readFileSync(dockerfile)),hash(fs.readFileSync(source))])));
