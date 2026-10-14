import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupPermissionSql } from './controlled-backup-permission-sql.mjs';
const inputs={database:'fixture_db',databaseIdentitySha256:'a'.repeat(64),helperDefinitionSha256:'b'.repeat(64),creators:['jiangkong','jg_pol275_owner','postgres']};
test('disabled read identity receives only whole-backup reads and runtime keeps helper execute',()=>{
 const p=buildBackupPermissionSql(inputs);assert(p.applySql.includes('CREATE ROLE jiangkong_backup_reader NOLOGIN'));assert(p.applySql.includes('GRANT SELECT ON ALL TABLES'));assert(p.applySql.includes('REVOKE EXECUTE ON FUNCTION public.assert_fund_movement_write_context() FROM PUBLIC'));assert(p.applySql.includes('TO jiangkong_runtime'));assert(!p.applySql.includes(' PASSWORD '));assert(!/\bBYPASSRLS\b/.test(p.applySql));assert.equal(p.credentialsGenerated,false);assert.equal(p.productionApplied,false);
});
for(const [name,change]of[['unknown creator',x=>x.creators.push('other')],['unsafe database',x=>x.database='fixture;DROP'],['missing helper fingerprint',x=>x.helperDefinitionSha256='']])test(name+' refuses permission preparation',()=>{const x=structuredClone(inputs);change(x);assert.throws(()=>buildBackupPermissionSql(x));});
test('rollback binds newly recorded role oid and retains other grants',()=>{
 const p=buildBackupPermissionSql(inputs);assert.throws(()=>p.rollbackSql('unknown'));
 const sql=p.rollbackSql(17001);assert(sql.includes('oid<>17001'));assert(sql.includes('GRANT EXECUTE ON FUNCTION public.assert_fund_movement_write_context() TO PUBLIC'));assert(sql.includes('DROP ROLE jiangkong_backup_reader'));assert(!sql.includes('DROP OWNED'));assert(!sql.includes('CASCADE'));
});
