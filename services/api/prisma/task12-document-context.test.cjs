'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDocumentContextAuthority } = require('./task12-document-context.cjs');

test('separate issuers cannot inject context into another authority', async () => {
  const a = createDocumentContextAuthority(), b = createDocumentContextAuthority();
  const proof = a.issue({ lockSha256:'a'.repeat(64) }, () => {});
  await assert.rejects(b.run(proof,() => assert.fail('foreign proof')),{ code:'TASK12_OFFICIAL_DOCUMENT_SCOPE' });
  assert.equal(b.current(),undefined);
});
test('concurrent document scopes keep their exact lock and parent environment', async () => {
  const authority = createDocumentContextAuthority();
  const before = { ...process.env };
  let release;
  const gate = new Promise(resolve => { release=resolve; });
  const a = authority.issue({lockSha256:'a'.repeat(64)},() => {}), b = authority.issue({lockSha256:'b'.repeat(64)},() => {});
  const first = authority.run(a,async () => { await gate; return authority.current().lockSha256; });
  const second = authority.run(b,async () => { release(); await Promise.resolve(); return authority.current().lockSha256; });
  assert.deepEqual(await Promise.all([first,second]),['a'.repeat(64),'b'.repeat(64)]);
  assert.equal(authority.current(),undefined); assert.deepEqual({...process.env},before);
  await assert.rejects(authority.run(a,() => {}),{code:'TASK12_OFFICIAL_DOCUMENT_SCOPE'});
});
test('scope exit revokes late asynchronous work, retained check and copied proof', async () => {
  const authority = createDocumentContextAuthority(); let late, retained;
  const proof = authority.issue({lockSha256:'c'.repeat(64)},() => {});
  let resume; const gate = new Promise(resolve => { resume=resolve; });
  await authority.run(proof,async scope => {
    retained=scope.check;
    late=(async () => { await gate; return authority.current(); })();
  });
  resume();
  await assert.rejects(late,{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
  assert.throws(retained,{code:'TASK12_OFFICIAL_DOCUMENT_CONTINUITY'});
  await assert.rejects(authority.run({...proof},() => {}),{code:'TASK12_OFFICIAL_DOCUMENT_SCOPE'});
});
