"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
test('current259 technical migration rejects caller-created resource/profile before any execution',()=>{
 const {createCurrent259TechnicalMigration}=require('./local-staged-current259-profile.cjs');
 for(const handle of [{},{kind:'CURRENT259_OWNED_RESOURCE'},Object.freeze({scope:'OWNED_RESOURCE_ONLY'})])
  assert.throws(()=>createCurrent259TechnicalMigration(handle),/CURRENT259_RESOURCE_HANDLE/);
});

test('fixed native import order loads actual profile/resource/core without resource execution',()=>{
 const {spawnSync}=require('node:child_process'),path=require('node:path');
 const entry=path.join(__dirname,'local-staged-current259-profile.cjs');
 const script=`const assert=require('node:assert/strict');const path=require('node:path');
 const entry=${JSON.stringify(entry)};const root=path.dirname(entry);
 const api=require(entry),owned=require(path.join(root,'task16-current259-owned-resource.cjs'));
 assert.equal(typeof owned.withCurrent259OwnedResource,'function');
 assert.equal(typeof require(path.join(root,'task16-current259-owner-tls.cjs')).verifyCurrent259OwnerTls,'function');
 assert.equal(typeof require(path.join(root,'local-staged-migrations.cjs')).createLocalMigrationFixture,'function');
 assert.throws(()=>api.createCurrent259TechnicalMigration({}),/CURRENT259_RESOURCE_HANDLE/);`;
 const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);
});

test('old PFQ imports do not load owned resource and cannot become the fixed native entry',()=>{
 const {spawnSync}=require('node:child_process');
 const root=__dirname;
 const script=`const assert=require('node:assert/strict');const path=require('node:path');const root=${JSON.stringify(root)};
 require(path.join(root,'local-staged-migrations.cjs'));
 assert.equal(require.cache[require.resolve(path.join(root,'task16-current259-owned-resource.cjs'))],undefined);
 const api=require(path.join(root,'local-staged-current259-profile.cjs'));
 assert.throws(()=>api.createCurrent259TechnicalMigration({}),/CURRENT259_TECHNICAL_PROFILE/);`;
 const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',timeout:10000});
 assert.equal(child.status,0,child.stderr);
});
