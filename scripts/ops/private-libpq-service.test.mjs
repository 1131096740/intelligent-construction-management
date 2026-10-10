import assert from 'node:assert/strict';
import { readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { connectionParameters, prepareService } from './private-libpq-service.mjs';

test('URI decodes credentials and preserves libpq query options with last value authority', () => {
  const p = connectionParameters('postgresql://user:p%3Aa%5Css@localhost:5432/db?sslmode=require&application_name=backup&user=reader');
  assert.equal(p.get('password'), 'p:a\\ss');
  assert.equal(p.get('user'), 'reader');
  assert.equal(p.get('dbname'), 'db');
  assert.equal(p.get('sslmode'), 'require');
});
test('quoted libpq keyword connections retain escaping and duplicate precedence', () => {
  const p = connectionParameters("host=localhost user=old user='reader' password='a\\\\b\\'c: d' dbname=fixture");
  assert.equal(p.get('user'), 'reader');
  assert.equal(p.get('password'), "a\\b'c: d");
});
for (const [name, value] of Object.entries({ newline: 'host=localhost\nuser=x password=bad\nvalue', injection: 'postgresql://u:p@localhost/db?host=x%0Apassword%3Devil', separator: "user='x'password=y", nested: 'service=other', escape: 'password=bad\\' })) {
  test(`refuses ${name} rather than creating an unsafe service configuration`, () => assert.throws(() => connectionParameters(value)));
}
test('credentials use private service/pass files with pgpass escaping and no service password', async () => {
  const dir = await prepareService('postgresql://reader:a%3Ab%5Cc%20%23@localhost/fixture');
  try {
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    for (const file of ['service.conf', 'pgpass', 'explicit-password']) assert.equal((await stat(join(dir,file))).mode & 0o777, 0o600);
    const service = await readFile(join(dir,'service.conf'),'utf8');
    assert(!service.includes('password='));
    assert(service.includes(`passfile=${join(dir,'pgpass')}`));
    assert.equal(await readFile(join(dir,'pgpass'),'utf8'), '*:*:*:*:a\\:b\\\\c #\n');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('a no-password connection retains native authentication without fabricating a password', async () => {
  const dir = await prepareService('host=localhost user=reader dbname=fixture');
  try { await assert.rejects(stat(join(dir,'pgpass'))); assert(!(await readFile(join(dir,'service.conf'),'utf8')).includes('password')); }
  finally { await rm(dir,{recursive:true,force:true}); }
});

for (const input of [
  'postgresql://reader@localhost/actual#archive',
  'postgresql://reader@localhost/actual?application_name=backup#archive',
  'postgresql://reader@localhost/db/../actual',
  'postgresql://reader@localhost/db/%2e%2e/actual',
  'postgresql://reader@localhost/act\nual',
  'postgresql://reader@localhost/act\tual'
]) test(`refuses URI normalization of ${JSON.stringify(input)}`, () => assert.throws(() => connectionParameters(input)));

test('encoded hash and literal query plus keep their libpq meaning', () => {
  const p = connectionParameters('postgresql://reader@localhost/actual%23archive?application_name=backup+archive');
  assert.equal(p.get('dbname'), 'actual#archive');
  assert.equal(p.get('application_name'), 'backup+archive');
});

test('Unicode and percent encoding that preserve the database name remain accepted', () => {
  assert.equal(connectionParameters('postgresql://reader@localhost/工程归档').get('dbname'), '工程归档');
  assert.equal(connectionParameters('postgresql://reader@localhost/actual%2Farchive').get('dbname'), 'actual/archive');
  assert.equal(connectionParameters('postgresql://reader@localhost/actual%252e%252e').get('dbname'), 'actual%2e%2e');
});
