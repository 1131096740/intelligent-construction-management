import { readLedgerCompetitionPayment } from "./registered-payment-ledger-competition-observer";

describe("ledger competition observer (simulated observer; no PostgreSQL)", () => {
 const ids={projectId:"project-1",settlementId:"settlement-1",settlementFactId:"settlement-fact",executionId:"execution-1",payerId:"company-b"};
 function setup() {
  const facts=[{id:"fact-1",projectId:ids.projectId,status:"confirmed",actualPayerSubjectKind:"participating_company",actualPayerSubjectId:ids.payerId}];
  const mk=(impactKind:string,direction:string,subjectKind:string,subjectId:string)=>({factId:"fact-1",projectId:ids.projectId,impactKind,direction,subjectKind,subjectId,amountCents:3000n,numericProtocolVersion:1});
  const impacts=[mk("payable_decrease","decrease","downstream_counterparty","supplier"),mk("company_project_funds_decrease","decrease","participating_company",ids.payerId),mk("inter_subject_balance_increase","increase","participating_company",ids.payerId)];
  const settlement=[{factId:"settlement-fact",projectId:ids.projectId,impactKind:"payable_increase",direction:"increase",subjectKind:"downstream_counterparty",subjectId:"supplier",amountCents:4000n,numericProtocolVersion:1},{factId:"settlement-fact",projectId:ids.projectId,impactKind:"confirmed_cost",direction:"increase",subjectKind:"participating_company",subjectId:"company-a",amountCents:4000n,numericProtocolVersion:1}];
  const tx={$executeRawUnsafe:jest.fn().mockResolvedValue(0),operatingFact:{findMany:jest.fn().mockResolvedValue(facts)},operatingImpactEntry:{findMany:jest.fn().mockResolvedValueOnce(impacts).mockResolvedValueOnce(settlement)}};
  const observer={$transaction:jest.fn(async(fn:(x:typeof tx)=>Promise<unknown>)=>fn(tx))};return {observer,tx,facts,impacts,settlement};
 }
 it("checks the winner fact and all three exact impacts against settlement payee",async()=>{
  const f=setup();await expect(readLedgerCompetitionPayment(f.observer as never,ids)).resolves.toEqual({factId:"fact-1",impactCount:3});
  expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");expect(f.observer.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:"RepeatableRead"});
 });
 it.each(["duplicate","amount","payer","payee","kind","settlementFact","settlementCost","factStatus"])("rejects a mismatched %s",async mismatch=>{
  const f=setup();if(mismatch==="duplicate")f.impacts.push({...f.impacts[0]!});if(mismatch==="amount")f.impacts[0]!.amountCents=2999n;
  if(mismatch==="payer")f.facts[0]!.actualPayerSubjectId="other";if(mismatch==="payee")f.impacts[0]!.subjectId="other";
  if(mismatch==="kind")f.impacts[2]!.impactKind="other";
  if(mismatch==="factStatus")f.facts[0]!.status="reversed";if(mismatch==="settlementFact")f.settlement[0]!.factId="other";if(mismatch==="settlementCost")f.settlement[1]!.amountCents=3999n;
  await expect(readLedgerCompetitionPayment(f.observer as never,ids)).rejects.toThrow("PG_COMPETITION_LEDGER_EVIDENCE");
 });
});
