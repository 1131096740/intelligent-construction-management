import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCosHold, exactCosRollback, PRINCIPALS } from './controlled-cos-hold-policy.mjs';
test('preserves original policy statements and limits denies to business bucket and known identities', () => {
  const original = { version: '2.0', Statement: [{ Sid: 'Existing', Effect: 'allow', Principal: { qcs: ['fixture'] }, Action: ['name/cos:GetObject'], Resource: ['fixture-resource'] }] };
  const bytes = Buffer.from(JSON.stringify(original));
  const packet = prepareCosHold(bytes, 'fixture'), after=JSON.parse(packet.afterBytes);
  assert.deepEqual(after.Statement[0], original.Statement[0]);
  assert.deepEqual(after.Statement[1].Principal.qcs, PRINCIPALS.map(u => `qcs::cam::uin/100049377606:uin/${u}`));
  assert(after.Statement[1].Resource[0].includes('uid/1438687719:jiangkong-prod-files-1438687719/'));
  assert(!packet.afterBytes.toString().includes('jiangkong-prod-db-backups'));
  assert(!packet.afterBytes.toString().includes('name/cos:GetObject*'));
  assert.deepEqual(exactCosRollback(packet,packet.afterBytes),bytes);
  assert.equal(packet.writerCoverageVerified,false);
});
test('lowercase original is preserved without case duplicate statements', () => {
  const p=prepareCosHold(Buffer.from('{"version":"2.0","statement":[]}'),'fixture');
  const after=JSON.parse(p.afterBytes);
  assert.equal(after.Statement,undefined);assert.equal(after.statement.length,2);
});
test('wrong version, mixed casing, repeated hold and rollback drift are refused', () => {
  for (const value of [{version:'3.0',Statement:[]},{version:'2.0',Statement:[],statement:[]},{version:'2.0',Statement:[{Sid:'ControlledFirstLaunch-old'}]}]) assert.throws(()=>prepareCosHold(Buffer.from(JSON.stringify(value)),'fixture'));
  const p=prepareCosHold(Buffer.from('{"version":"2.0","Statement":[]}'),'fixture');
  assert.throws(()=>exactCosRollback(p,Buffer.from('{}')),/drift/);
});

test('anonymous deny never substitutes for explicit CAM identities',()=>{
 const p=prepareCosHold(Buffer.from('{"version":"2.0","Statement":[]}'),'fixture','known-and-anonymous');
 const a=JSON.parse(p.afterBytes);assert.equal(a.Statement[0].Principal.qcs.length,3);assert.deepEqual(a.Statement[2].Principal,{qcs:['*']});
 assert.equal(p.writerCoverageVerified,false);assert.throws(()=>prepareCosHold(p.beforeBytes,'fixture','all-principals'));
});
