'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {buildCurrent259FirstQ2Fixture}=require('./task12-current259-q2-fixture.cjs');
const {createCurrent259FirstQ2Seed}=require('./task12-current259-q2-seed.cjs');

const caseId='12345678-1234-4234-8234-123456789012';
const identity=Object.freeze({database:'jg_task01_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',databaseOid:'200',namespaceOid:'2200',
  ownerOid:'10',actorOid:'10',actor:'jg_task01_owner',sessionActor:'jg_task01_owner',systemIdentifier:'1234',tls:true,
  clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',serverPort:5432});
const backend=pid=>({pid,start:'2026-11-11T10:00:00.000'+String(pid).padStart(3,'0')+'Z'});

function row(sql,phase,number=100,extra={}) {
  const nonce=sql.match(/'nonce','([a-f0-9]{64})'/u)?.[1];
  assert.ok(nonce);
  const write=phase==='write';
  return JSON.stringify({phase,nonce,identity,backend:backend(number),readOnly:!write,
    isolation:write?'serializable':'repeatable read',writeXid:write?'803':null,
    commitStatus:phase==='committed'?'committed':null,matches:true,...extra});
}

test('only the nine ordered inserts and a single exact open-mode update run between the owner proof stages',()=>{
  for(const operating of [false,true]){
    const fixture=buildCurrent259FirstQ2Fixture(caseId,'2026-11-11',operating);
    const plan=createCurrent259FirstQ2Seed(fixture,identity);
    assert.throws(()=>plan.writeSql(),/STATE/u);
    const before=plan.beforeSql();
    assert.match(before,/REPEATABLE READ READ ONLY/u);
    plan.verifyBefore(row(before,'before',100));
    const write=plan.writeSql();
    assert.match(write,/ISOLATION LEVEL SERIALIZABLE READ WRITE/u);
    assert.ok(write.indexOf("SET log_min_error_statement='panic'")<write.indexOf('INSERT INTO'));
    assert.deepEqual([...write.matchAll(/^INSERT INTO public\."([A-Za-z]+)"/gmu)].map(match=>match[1]),Object.keys(fixture.seed));
    assert.doesNotMatch(write,/\b(?:GRANT|REVOKE|ALTER|TRUNCATE)\b/u);
    assert.equal((write.match(/UPDATE public\."Project"/gu)??[]).length,Number(operating));
    if(operating){
      assert.ok(write.indexOf('UPDATE public."Project"')>write.indexOf('INSERT INTO public."ProjectParticipatingCompany"'));
      assert.match(write,new RegExp('WHERE "id"='+"'"+fixture.seed.Project.id+"'"+' AND "operatingLedgerEffectiveDate" IS NULL','u'));
      assert.match(write,/GET DIAGNOSTICS affected=ROW_COUNT;\s*IF affected<>1/u);
    }
    const postGuard=write.indexOf('DO $first_q2_seed_post$');
    assert.ok(postGuard>write.lastIndexOf('INSERT INTO') && postGuard<write.indexOf('COMMIT;'));
    assert.match(write.slice(postGuard),/IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'FIRST_Q2_SEED_POSTIMAGE'/u);
    assert.match(write,/COMMIT;$/u);
    plan.verifyWritten(row(write,'write',101));
    const committed=plan.committedSql();
    assert.match(committed,/pg_xact_status\('803'::xid8\)/u);
    assert.doesNotMatch(committed,/\b(?:INSERT INTO|UPDATE public)\b/u);
    assert.deepEqual(plan.finish(row(committed,'committed',102)),{seedRows:9,operating,seedXid:'803'});
    assert.throws(()=>plan.writeSql(),/STATE/u);
  }
});

test('upload readback binds independent owner FileObject and same-transaction audit to the fixed PDF and approved bucket',()=>{
  const {createCurrent259FirstQ2UploadReadback}=require('./task12-current259-q2-seed.cjs');
  const fixture=buildCurrent259FirstQ2Fixture(caseId,'2026-11-11',false);
  const original=fixture.original;
  const bucket='q2-isolated-1234567890';
  const upload={fileId:original.fileId,bucket,
    objectKey:fixture.uploadPrefix+caseId+'-'+original.contentSha256+'-'+original.originalName,
    mimeType:original.mimeType,sizeBytes:original.sizeBytes,contentSha256:original.contentSha256};
  const read=createCurrent259FirstQ2UploadReadback(fixture,identity,bucket,upload);
  assert.match(read.sql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/u);
  assert.match(read.sql,/FROM public\."FileObject" f/u);
  assert.match(read.sql,/FROM public\."AuditLog" a/u);
  assert.match(read.sql,/f\.xmin=a\.xmin/u);
  assert.match(read.sql,/a\."metadata" IS NOT DISTINCT FROM/u);
  assert.deepEqual(read.finish(row(read.sql,'upload',100)),upload);
  assert.throws(()=>read.finish(row(read.sql,'upload',101)),/STATE/u);
  for(const patch of [{fileId:caseId},{bucket:'other-1234567890'},{contentSha256:'0'.repeat(64)},{objectKey:'elsewhere/file.pdf'}]){
    assert.throws(()=>createCurrent259FirstQ2UploadReadback(fixture,identity,bucket,{...upload,...patch}),/INPUT/u);
  }
  const changed=createCurrent259FirstQ2UploadReadback(fixture,identity,bucket,upload);
  assert.throws(()=>changed.finish(row(changed.sql,'upload',101,{matches:false})),/UPLOAD/u);
  assert.throws(()=>changed.finish(row(changed.sql,'upload',102)),/STATE/u);
});

test('archive readback selects the fixed coordinates and checks the same transaction from independent owner',()=>{
  const {createCurrent259FirstQ2ArchiveReadback}=require('./task12-current259-q2-seed.cjs');
  const fixture=buildCurrent259FirstQ2Fixture(caseId,'2026-11-11',true);
  const versionId='12345678-1234-4234-8234-123456789013',contractId='12345678-1234-4234-8234-123456789014',
    archiveId='12345678-1234-4234-8234-123456789015',idempotencyKey=fixture.archiveIdempotencyKey;
  const coords={actorId:fixture.seed.User.id,projectId:fixture.seed.Project.id,contractId,versionId,archiveId,idempotencyKey,
    fileId:fixture.original.fileId,revision:2,inputSha256:'a'.repeat(64),requestSha256:'b'.repeat(64)};
  const read=createCurrent259FirstQ2ArchiveReadback(fixture,identity,coords);
  assert.match(read.sql,/REPEATABLE READ READ ONLY/u);
  assert.match(read.sql,/a\.xmin=v\.xmin AND a\.xmin=e\.xmin AND a\.xmin=l\.xmin/u);
  assert.match(read.sql,/a\."authoritySnapshot"#>'\{sourceBasis,directInput,Q\}'/u);
  assert.match(read.sql,/f\."id"=.*f\."storageStatus"='active'/u);
  assert.match(read.sql,/FROM public\."OperatingFact"/u);
  assert.match(read.sql,/FROM public\."OperatingImpactEntry"/u);
  const evidence={archive:{id:archiveId},version:{id:versionId},counts:{archives:1},archivedFile:{fileId:coords.fileId},
    archiveAudit:{actorUserId:coords.actorId}};
  const result=(extra={})=>JSON.stringify({witness:JSON.parse(row(read.sql,'archive',102,extra)),evidence});
  assert.deepEqual(read.finish(result()),evidence);
  assert.throws(()=>read.finish(result()),/STATE/u);
  const changed=createCurrent259FirstQ2ArchiveReadback(fixture,identity,coords);
  assert.throws(()=>changed.finish(JSON.stringify({witness:JSON.parse(row(changed.sql,'archive',102,{matches:false})),evidence})),/ARCHIVE/u);
  assert.throws(()=>createCurrent259FirstQ2ArchiveReadback(fixture,identity,{...coords,actorId:caseId}),/INPUT/u);
});

test('outside seeds the distinct counterparty before readback and uses the separate stored-generation proof',()=>{
  const {buildCurrent259FirstOutsideDirectFixture}=require('./task12-current259-q2-fixture.cjs');
  const {createCurrent259FirstQ2ArchiveReadback}=require('./task12-current259-q2-seed.cjs');
  const fixture=buildCurrent259FirstOutsideDirectFixture(caseId,'2026-11-11');
  const seed=createCurrent259FirstQ2Seed(fixture,identity);
  const before=seed.beforeSql();
  seed.verifyBefore(row(before,'before',100));
  const write=seed.writeSql();
  assert.equal([...write.matchAll(/^INSERT INTO public\."BusinessParty"/gmu)].length,2);
  assert.equal([...write.matchAll(/^INSERT INTO public\."BusinessPartyVersion"/gmu)].length,2);
  assert.doesNotMatch(write,/UPDATE public\."Project"/u);
  seed.verifyWritten(row(write,'write',101));
  const committed=seed.committedSql();
  assert.match(committed,new RegExp(fixture.counterparty.party.id,'u'));
  assert.match(committed,new RegExp(fixture.counterparty.version.id,'u'));
  assert.deepEqual(seed.finish(row(committed,'committed',102)),{seedRows:11,operating:false,seedXid:'803'});

  const coordinates={actorId:fixture.seed.User.id,projectId:fixture.seed.Project.id,contractId:'12345678-1234-4234-8234-123456789013',
    versionId:'12345678-1234-4234-8234-123456789014',archiveId:'12345678-1234-4234-8234-123456789015',
    idempotencyKey:fixture.archiveIdempotencyKey,fileId:fixture.original.fileId,revision:2,inputSha256:'a'.repeat(64),requestSha256:'b'.repeat(64)};
  const archive=createCurrent259FirstQ2ArchiveReadback(fixture,identity,coordinates);
  assert.match(archive.sql,/jg_read_contract_direct_archive_generations_v1\(a\."id"\)/u);
  assert.match(archive.sql,/g\.proof->>'authoritySha256'=a\."authoritySha256"/u);
  assert.match(archive.sql,/stored\.xmin=a\.xmin/u);
  assert.doesNotMatch(archive.sql,/a\."authoritySnapshot"#>'\{originals,0\}'/u);
  const evidence={archive:{},archiveAudit:{},archivedFile:{},counts:{},version:{}};
  const proof=JSON.parse(row(archive.sql,'archive',103));
  assert.throws(()=>archive.finish(JSON.stringify({witness:proof,evidence})),/ARCHIVE/u);
});

test('the operating fixture activates its project after coverage and reads V2 issue, use and ledger without V1 generation fallback',()=>{
  const {buildCurrent259FirstOutsideOperatingFixture}=require('./task12-current259-q2-fixture.cjs');
  const {createCurrent259FirstQ2ArchiveReadback}=require('./task12-current259-q2-seed.cjs');
  const fixture=buildCurrent259FirstOutsideOperatingFixture(caseId,'2026-11-11');
  const seed=createCurrent259FirstQ2Seed(fixture,identity);
  const before=seed.beforeSql();
  seed.verifyBefore(row(before,'before',100));
  const write=seed.writeSql();
  assert.ok(write.indexOf('UPDATE public."Project"')>write.indexOf('INSERT INTO public."ProjectParticipatingCompany"'));
  seed.verifyWritten(row(write,'write',101));
  const committed=seed.committedSql();
  assert.deepEqual(seed.finish(row(committed,'committed',102)),{seedRows:11,operating:true,seedXid:'803'});
  const coordinates={actorId:fixture.seed.User.id,projectId:fixture.seed.Project.id,contractId:'12345678-1234-4234-8234-123456789013',
    versionId:'12345678-1234-4234-8234-123456789014',archiveId:'12345678-1234-4234-8234-123456789015',
    idempotencyKey:fixture.archiveIdempotencyKey,fileId:fixture.original.fileId,revision:2,inputSha256:'a'.repeat(64),requestSha256:'b'.repeat(64)};
  const archive=createCurrent259FirstQ2ArchiveReadback(fixture,identity,coordinates);
  assert.match(archive.sql,/REPEATABLE READ READ ONLY/u);
  assert.match(archive.sql,/JOIN public\.jg_contract_direct_outside_operating_receipt_v2/u);
  assert.match(archive.sql,/JOIN public\.jg_contract_direct_outside_operating_use_v2/u);
  assert.match(archive.sql,/pg_catalog.pg_xact_status\(used\."transactionId"::text::xid8\)='committed'/u);
  assert.match(archive.sql,/used\.xmin=a\.xmin AND fact\.xmin=a\.xmin AND impact\.xmin=a\.xmin/u);
  assert.match(archive.sql,/issued\.xmin<>used\.xmin/u);
  assert.doesNotMatch(archive.sql,/jg_read_(?:contract_direct_archive_generations_v1|direct_outside_operating_archive_v2)/u);
});
