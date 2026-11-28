from pathlib import Path
import hashlib, subprocess, tempfile, re, sys
assert len(sys.argv) in (3, 4), 'usage: build-435-fixture.py CANDIDATE_SHA OUTPUT [issue411|issue435]'
mode=sys.argv[3] if len(sys.argv)==4 else 'combined'
assert mode in ('combined','issue411','issue435')
repo=str(Path(__file__).resolve().parents[4])
target=sys.argv[1]
file='services/api/src/database/issue411-third-company-repayment.pg.spec.ts'
def show(sha): return subprocess.check_output(['git','-C',repo,'show',f'{sha}:{file}'],text=True)
original_path=Path(__file__).with_name('issue411-original.fixture.ts')
original_bytes=original_path.read_bytes()
assert hashlib.sha256(original_bytes).hexdigest() == '46f2bf46d6b1de968da67fd60fea9d90e249870db283210c330c9f59e4c4d86e', 'ISSUE411_ORIGINAL_FIXTURE_PIN'
original=original_bytes.decode()
with tempfile.TemporaryDirectory(prefix='jg435-patch-') as d:
 p=Path(d)/'fixture.ts';p.write_text(original);subprocess.run(['git','-C',d,'apply','--unidiff-zero',repo+'/.github/task12-install-295/contract-finance/issue-ordered/issue411.fixture.patch'],check=True); initial=p.read_text()
source=show(target)
first='  it("moves A-B debt to A-C'
end='  const settledReturnCase = process.env.RUN_ISSUE435_SETTLED_RETURN'
assert original[original.index(first):original.rindex('\n});')].rstrip() == source[source.index(first):source.index(end)].rstrip(), 'ISSUE411_ORIGINAL_CASES_CHANGED'
if mode=='issue411':
 Path(sys.argv[2]).write_text(initial)
 raise SystemExit(0)
if mode=='issue435':
 initial=initial[:initial.index(first)]+'\n});\n'
missing=[line for line in source.splitlines() if line.startswith('import ') and line not in initial]
missing.append('import { Prisma } from "@prisma/client";')
initial=initial.replace('import "reflect-metadata";\n', 'import "reflect-metadata";\n'+'\n'.join(missing)+'\n', 1)
marker='  const settledReturnCase = process.env.RUN_ISSUE435_SETTLED_RETURN'; assert source.count(marker)==1
body=source[source.index(marker):];assert body.endswith('\n});\n')
def rep(a,b):
 global body
 assert body.count(a)==1,(a[:100],body.count(a));body=body.replace(a,b)
rep('    await seedCompanies();\n','')
start=body.index('    const verification = async (companyId: string)');end=body.index('    const visibility = new ProjectVisibilityService',start);body=body[:start]+body[end:]
rep('''    const verifyReturn = (amountCents: bigint, date: string) => prisma.$transaction(tx => observation(tx, {
      holder: c, name: "丙合成公司", projectId, account: accountC, direction: "inflow",
      amountCents, occurredAt: new Date(date), actor: financeDirector, payerVerificationId: verificationC,
    }));''','''    const verifyReturn = async (amountCents: bigint, date: string) =>
      (await observation(c, accountC, "inflow", amountCents, new Date(date))).id;''')
for x in ['verificationA','verificationB','verificationC','verificationB.id','verificationC.id']:
 body=body.replace(', '+x+', original.outgoing',', original.outgoing').replace(', '+x+', outgoing',', outgoing').replace(', '+x+', sent',', sent').replace(', '+x+');',');')
body=re.sub(r'    const verification[BC] = await prisma\.paymentExecutionPayerVerification\.findFirstOrThrow\([^\n]+\);\n','',body)
rep('''      const observationId = await prisma.$transaction(tx => observation(tx, {
        holder: c, name: "丙合成公司", projectId, account: cAccount, actor: financeDirector,
        direction: "inflow", amountCents, occurredAt, payerVerificationId: verificationC.id,
      }));''','''      const observationId = (await observation(c, cAccount, "inflow", amountCents, occurredAt)).id;''')
proxy_start=body.index('    const original = await prisma.contractProxyExecution.create({ data: {',body.index('issue 435 keeps the debt correction'))
proxy_end=body.index('    const target = await prisma.interEntityRelationshipEntry.create',proxy_start)
body=body[:proxy_start]+'''    const proxyAccount = "6222000022222222";
    const proof = await observation(b, proxyAccount, "outflow", 800n, debtDate);
    const signature = await prisma.handwrittenSignatureVersion.findFirstOrThrow({ where: { userId: financeDirector } });
    const proxyEvidence = await file(financeStaff);
    ok(proxyEvidence.contentSha256);
    const original = await prisma.$transaction(async tx => {
      const pending = await tx.contractProxyExecution.create({ data: {
        projectId, sourceRef: `settlement:${randomUUID()}`, entryKind: "payment", amountCents: 800n,
        occurredAt: debtDate, actualPayerKey: `participating_company:${b.companyId}`, bankReference: proof.bankReference,
        bankObservationId: proof.id, evidenceFileId: proxyEvidence.id, evidenceSha256: proxyEvidence.contentSha256!,
        reason: "隔离合成原代付", status: "pending_confirm", recordedByUserId: financeStaff,
        frozenSource: { debtor, actualPayer: creditor }, idempotencyKey: randomUUID(), requestFingerprint: randomUUID(),
      } });
      await tx.contractProxyBankClaim.create({ data: { proxyExecutionId: pending.id, observationId: proof.id } });
      return tx.contractProxyExecution.update({ where: { id: pending.id }, data: {
        status: "confirmed", confirmedByUserId: financeDirector, confirmedAt: debtDate,
        confirmationSignatureVersionId: signature.id,
      } });
    });
''' +body[proxy_end:]
# The target is an actual confirmed cross-company settlement, built from the
# existing payable-settlement fixture rather than a fabricated confirmed row.
payable_file='services/api/src/database/payable-settlement-concurrency.spec.ts'
payable=subprocess.check_output(['git','-C',repo,'show',f'{target}:{payable_file}'],text=True)
def section(start, end):
 assert payable.count(start)==1 and payable.count(end)==1
 return payable[payable.index(start):payable.index(end)]
types=section('type PayerAuthority = {','export function payableSettlementDatabaseUrl')
types='type DatabaseClient = PrismaClient | Prisma.TransactionClient;\n'+types
payer=section('async function createPayerAuthority(', 'async function allocateWithExecutionLock(')
payer=payer.replace('Pick<Fixture, "debtorCompanyId" | "executionPayerCompanyId">',
 '{ debtorCompanyId: string; executionPayerCompanyId: string }')
payer=payer.replace('"动态门实际付款主体"','"乙合成公司"')
eligible=section('async function createEligibleServiceFixture(', 'type HistoricalWageFixture =')
eligible=eligible.replace('  crossCompany = false\n)', '  crossCompany = true\n)')
eligible=eligible.replace('const companyId = randomUUID();','const companyId = a.companyId;')
eligible=eligible.replace('const executionPayerCompanyId = crossCompany ? randomUUID() : companyId;',
 'const executionPayerCompanyId = crossCompany ? b.companyId : companyId;')
old='const executionPayerCreditCode = crossCompany\n    ? `DYN${executionPayerCompanyId.replace(/-/g, "").slice(0, 15).toUpperCase()}`\n    : "91310000DYNAMICGATE";'
assert eligible.count(old)==1
eligible=eligible.replace(old,'const executionPayerCreditCode = crossCompany ? b.companyCreditCode : a.companyCreditCode;')
eligible=eligible.replace('const companyVersionId = randomUUID();','const companyVersionId = a.companyVersionId;')
eligible=eligible.replace('const projectId = randomUUID();','const projectId = a.projectId;')
start=eligible.index('  await client.project.create({'); end=eligible.index('  await client.contract.create({',start)
eligible=eligible[:start]+eligible[end:]
eligible=eligible.replace('"动态门付款主体"','"甲合成公司"').replace('"动态门实际付款主体"','"乙合成公司"')
eligible=eligible.replace('`DYN${companyId.replace(/-/g, "").slice(0, 15)}`','a.companyCreditCode')
allocation=section('async function seedHistoricalAllocation(', 'function dynamicFile(')
filefn=payable[payable.index('function dynamicFile('):]
assert filefn.rstrip().endswith('}')
helpers=types+payer+eligible+'type HistoricalWageFixture = Awaited<ReturnType<typeof createEligibleServiceFixture>>;\n'+allocation+filefn
cross=section('    const fixture = await createEligibleServiceFixture(observer, 1_000n, true);',
 '    if (!directoryActive) {')
cross=cross.replace('observer','prisma').replace('const relationship =', 'const target =')
cross=cross.replace('2026-08-27','2026-08-04')
start=body.index('    const target = await prisma.interEntityRelationshipEntry.create',body.index('issue 435 keeps the debt correction'))
end=body.index('    const originalRef =',start)
body=body[:start]+cross+body[end:]
body=helpers+'\n'+body

assert 'verificationA' not in body and 'verificationB' not in body and 'verificationC' not in body
assert initial.endswith('\n});\n')
Path(sys.argv[2]).write_text(initial[:-5]+'\n'+body)
