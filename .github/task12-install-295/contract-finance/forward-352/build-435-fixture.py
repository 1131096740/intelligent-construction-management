from pathlib import Path
import subprocess, tempfile, re, sys
assert len(sys.argv) == 3, 'usage: build-435-fixture.py CANDIDATE_SHA OUTPUT'
repo=str(Path(__file__).resolve().parents[4])
base='1d10eb5a5d4759a4fe6f39e4de31135be3393d8d'
target=sys.argv[1]
file='services/api/src/database/issue411-third-company-repayment.pg.spec.ts'
def show(sha): return subprocess.check_output(['git','-C',repo,'show',f'{sha}:{file}'],text=True)
with tempfile.TemporaryDirectory(prefix='jg435-patch-') as d:
 p=Path(d)/'fixture.ts';p.write_text(show(base));subprocess.run(['git','-C',d,'apply','--unidiff-zero',repo+'/.github/task12-install-295/contract-finance/issue-ordered/issue411.fixture.patch'],check=True); initial=p.read_text()
source=show(target)
missing=[line for line in source.splitlines() if line.startswith('import ') and line not in initial]
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
assert 'verificationA' not in body and 'verificationB' not in body and 'verificationC' not in body
assert initial.endswith('\n});\n')
Path(sys.argv[2]).write_text(initial[:-5]+'\n'+body)
