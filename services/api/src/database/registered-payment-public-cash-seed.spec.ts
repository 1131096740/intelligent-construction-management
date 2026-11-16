import { mkdtempSync, realpathSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRegisteredPgFixturePlan } from "./registered-payment-postgres.fixture";
import { cash261SeedProfile, seedPayment261 } from "./registered-payment-postgres.seed261";

describe("cash source file binding during owner seed (simulated transaction)",()=>{
 let root: string; let previous: string | undefined;
 beforeEach(()=>{previous=process.env.FILE_STORAGE_ROOT;root=realpathSync(mkdtempSync(join(tmpdir(),"jg-cash-seed-")));process.env.FILE_STORAGE_ROOT=root;});
 afterEach(()=>{if(previous===undefined)delete process.env.FILE_STORAGE_ROOT;else process.env.FILE_STORAGE_ROOT=previous;for(const entry of readdirSync(root))unlinkSync(join(root,entry));rmdirSync(root);});
 it("creates the project inactive, supplies its participants, then enables the cash ledger before formal sources",async()=>{
  const plan=buildRegisteredPgFixturePlan("da49e313e3da","2026-11-07","2026-11-01");
  const tx={ $queryRawUnsafe:jest.fn().mockResolvedValue([{bound:true}]), $executeRawUnsafe:jest.fn().mockResolvedValue(0) };
  const owner={ $transaction:jest.fn(async(fn:(tx:unknown)=>Promise<void>)=>fn(tx)) };
  await seedPayment261(owner as never,"synthetic-db",plan,"synthetic-hash","a","b",()=>{},
   {profile:cash261SeedProfile,contender:{actorId:"actor",phone:"phone",passwordHash:"hash"}});
  const sql=tx.$executeRawUnsafe.mock.calls[0]![0] as string;
  const project=sql.indexOf('INSERT INTO public."Project"'),assignment=sql.indexOf('INSERT INTO public."ProjectAffiliateAssignment"');
  const participation=sql.indexOf('INSERT INTO public."ProjectParticipatingCompany"'),activation=sql.indexOf('UPDATE public."Project" SET "operatingLedgerEffectiveDate"');
  const contract=sql.indexOf('INSERT INTO public."Contract"');
  const version=sql.slice(sql.indexOf('INSERT INTO public."ContractVersion"'),sql.indexOf('INSERT INTO public."PaymentTermsVersion"'));
  expect(version).toMatch(/'our_company',[\s\S]*company_a\."unifiedSocialCreditCode",\s*NULL,NULL,/);
  const sourceReadback=sql.slice(sql.indexOf('IF cash AND NOT EXISTS ('),sql.indexOf("PG_FIXTURE_CASH_SOURCE_READBACK"));
  for(const column of ["affiliateAssignmentId","affiliateBusinessPartyVersionId","affiliateNameSnapshot","affiliateCreditCodeSnapshot"]){
   expect(sourceReadback).toContain(`v."${column}" IS NULL`);
  }
  expect(sourceReadback).not.toMatch(/v\."affiliate(?:AssignmentId|BusinessPartyVersionId)"\s*=/);
  const commonReadback=sql.slice(sql.indexOf('IF NOT EXISTS (\n    SELECT 1 FROM public."User"'),sql.indexOf("PG_FIXTURE_SEED_READBACK"));
  expect(commonReadback).toContain('pa."id"=assignment."id"');
  expect(commonReadback).toContain('pa."businessPartyVersionId"');
  expect(commonReadback).toContain('pa."projectId"=p."id"');
  expect(sql.slice(project,assignment)).toMatch(/true,NULL,/);
  expect(project).toBeLessThan(assignment);expect(assignment).toBeLessThan(participation);
  expect(participation).toBeLessThan(activation);expect(activation).toBeLessThan(contract);
  expect(sql.slice(assignment,contract)).toMatch(/IF cash THEN[\s\S]*UPDATE public\."Project" SET "operatingLedgerEffectiveDate"/);
 });
 it("rejects a changed source after binding before executing owner seed",async()=>{
  const plan=buildRegisteredPgFixturePlan("da49e313e3da","2026-11-07","2026-11-01");
  const tx={ $queryRawUnsafe:jest.fn(async()=>{writeFileSync(join(root,`cash-settlement-${plan.runId}.pdf`),"altered");return [{bound:true}];}), $executeRawUnsafe:jest.fn() };
  const owner={ $transaction:jest.fn(async(fn:(tx:unknown)=>Promise<void>)=>fn(tx)) };
  await expect(seedPayment261(owner as never,"synthetic-db",plan,"synthetic-hash","a","b",()=>{},
   {profile:cash261SeedProfile,contender:{actorId:"actor",phone:"phone",passwordHash:"hash"}})).rejects.toThrow("PUBLIC_CASH_DOCUMENT_CHANGED");
  expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
 });
});
