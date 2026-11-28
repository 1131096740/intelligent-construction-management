'use strict';
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {verifySql,scope}=require('./successor.cjs');
const plan=require('./app-inputs.json');
function checkClosure(root){
 const collect=prefix=>readdirSync(root+'/'+prefix,{withFileTypes:true}).flatMap(entry=>{
  const name=prefix+entry.name;
  assert.ok(entry.isDirectory()||entry.isFile());
  return entry.isDirectory()?collect(name+'/'):[name];
 });
 assert.deepEqual(collect('').sort(),Object.keys(plan.actual).sort());
 const h=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 for(const [file,digest] of Object.entries(plan.actual))assert.equal(h(root+'/'+file),digest);
 const filenames=[...new Set([...Object.keys(plan.exact),...Object.keys(plan.actual)])];
 assert.deepEqual(filenames.filter(file=>plan.exact[file]!==plan.actual[file]).sort(),plan.authorizedTestOverlays);
 assert.ok(plan.authorizedTestOverlays.every(file=>file.startsWith('database/')));
}
if(require.main===module){
 verifySql(require('node:path').join(__dirname,'successor.sql'));
 checkClosure(process.argv[2]);
 console.log(JSON.stringify({status:'CORRECTION_290_BEHAVIOR_SOURCE_ONLY',files:Object.keys(plan.actual).length,tree:scope.tree,postgres:false}));
}
module.exports={checkClosure};
