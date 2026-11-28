import type { Prisma, PrismaClient } from "@prisma/client";

type Identity = {projectId:string;settlementId:string;settlementFactId:string;executionId:string;payerId:string};
/** Caller must supply its already read-only repeatable-read observer transaction. */
export async function readLedgerCompetitionPaymentInTransaction(tx: Prisma.TransactionClient, identity: Identity, check: () => void = () => undefined) {
  const fail = (): never => { throw new Error("PG_COMPETITION_LEDGER_EVIDENCE"); };
  if (!identity.projectId || !identity.settlementId || !identity.settlementFactId || !identity.executionId || !identity.payerId) return fail();
  const checked = async <T>(operation: () => PromiseLike<T>): Promise<T> => { check(); const value=await operation(); check(); return value; };
  const facts=await checked(() => tx.operatingFact.findMany({where:{sourceType:"payment_execution",sourceBusinessId:identity.executionId},select:{id:true,projectId:true,status:true,actualPayerSubjectKind:true,actualPayerSubjectId:true}}));
  if(facts.length!==1 || facts[0]?.projectId!==identity.projectId || facts[0].status!=="confirmed" || facts[0].actualPayerSubjectKind!=="participating_company" || facts[0].actualPayerSubjectId!==identity.payerId) return fail();
  const factId=facts[0].id;
  const impacts=await checked(() => tx.operatingImpactEntry.findMany({where:{sourceType:"payment_execution",sourceBusinessId:identity.executionId},select:{factId:true,projectId:true,impactKind:true,direction:true,subjectKind:true,subjectId:true,amountCents:true,numericProtocolVersion:true}}));
  const settlement=await checked(() => tx.operatingImpactEntry.findMany({where:{projectId:identity.projectId,sourceType:"settlement",sourceBusinessId:identity.settlementId},select:{factId:true,projectId:true,impactKind:true,direction:true,subjectKind:true,subjectId:true,amountCents:true,numericProtocolVersion:true}}));
  const payable=settlement.filter(row=>row.impactKind==="payable_increase" && row.subjectKind==="downstream_counterparty" && !!row.subjectId);
  if(settlement.length!==2 || payable.length!==1 || !settlement.some(row=>row.impactKind==="confirmed_cost") || settlement.some(row=>row.factId!==identity.settlementFactId || row.projectId!==identity.projectId || row.direction!=="increase" || row.amountCents!==4000n || row.numericProtocolVersion!==1) ||
    impacts.length!==3 || impacts.some(row=>row.factId!==factId || row.projectId!==identity.projectId || row.amountCents!==3000n || row.numericProtocolVersion!==1)) return fail();
  const expected=[
    {impactKind:"payable_decrease",direction:"decrease",subjectKind:"downstream_counterparty",subjectId:payable[0]!.subjectId},
    {impactKind:"company_project_funds_decrease",direction:"decrease",subjectKind:"participating_company",subjectId:identity.payerId},
    {impactKind:"inter_subject_balance_increase",direction:"increase",subjectKind:"participating_company",subjectId:identity.payerId}
  ];
  if(!expected.every(want=>impacts.filter(row=>row.impactKind===want.impactKind && row.direction===want.direction && row.subjectKind===want.subjectKind && row.subjectId===want.subjectId).length===1)) return fail();
  return {factId,impactCount:3 as const};
}
/** Standalone adapter used in model tests; real competition uses its existing observer transaction. */
export async function readLedgerCompetitionPayment(observer: Pick<PrismaClient, "$transaction">, identity: Identity, check: () => void = () => undefined) {
  check();return observer.$transaction(async tx => {
    check();await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");check();
    return readLedgerCompetitionPaymentInTransaction(tx,identity,check);
  },{isolationLevel:"RepeatableRead"});
}
