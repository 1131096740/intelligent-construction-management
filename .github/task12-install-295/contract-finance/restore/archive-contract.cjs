'use strict';
const assert=require('node:assert/strict');
const {legacy}=require('./restore-profile.cjs');
const {technical}=legacy;
const pattern=name=>/[A-Z]/u.test(name)?'public."'+name+'"':'public.'+name;
const safeName=/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u;
function classifyArchive(toc, expectedTables, mode, profile=legacy) {
  assert.ok(mode==='business'||mode==='owner-schema');
  assert.ok(Array.isArray(expectedTables)&&expectedTables.every(name=>safeName.test(name)));
  const entries=(toc.match(/[^\r\n]+/gu)??[]).flatMap(line=>{
    const type=/^\d+; \d+ \d+ (TABLE DATA|TABLE) ([^ ]+) ([^ ]+) [^ ]+$/u.exec(line);
    return type?[{type:type[1],schema:type[2],name:type[3]}]:[];
  });
  assert.ok(entries.every(row=>row.schema==='public'&&safeName.test(row.name)),'BACKUP292_TOC_SCOPE');
  const declared=entries.filter(row=>row.type==='TABLE').map(row=>row.name).sort();
  const payload=entries.filter(row=>row.type==='TABLE DATA').map(row=>row.name).sort();
  assert.deepEqual(declared,[...expectedTables].sort(),'BACKUP292_TOC_TABLES');
  if(mode==='business'){
    assert.deepEqual(payload,[...expectedTables].sort(),'BACKUP292_TOC_BUSINESS_PAYLOADS');
    // Detect table-owned indexes and ACL entries that would make the role archive
    // depend on a private relation even if data had been filtered independently.
    assert.ok(profile.technical.every(name=>!new RegExp('(^|[^A-Za-z0-9_])'+name+'([^A-Za-z0-9_]|$)','mu').test(toc)),'BACKUP292_PRIVATE_ARCHIVE_MEMBER');
  }else{
    assert.deepEqual(payload,[],'BACKUP292_OWNER_ARCHIVE_HAS_DATA');
  }
  return {tables:declared.length,payloads:payload.length};
}
function pgDumpArgs(db,filename,mode,profile=legacy) {
  assert.match(db,/^jg_task01_[a-f0-9]{32}$/u);
  const argv=['--dbname',db,'--format=custom','--file',filename];
  if(mode==='business') return [...argv,...profile.technical.map(name=>'--exclude-table='+pattern(name))];
  assert.equal(mode,'owner-schema');
  return [...argv,'--schema-only',...profile.technical.map(name=>'--table='+pattern(name))];
}
module.exports={technical,pgDumpArgs,classifyArchive};
