import { economicDocuments } from "./contract-economic-coverage";
import { reviewDocumentFingerprint } from "./contract-direct-review-source";
import { ContractEconomicReviewService } from "./contract-economic-review.service";

jest.mock("./contract-economic-coverage",()=>({
  ...jest.requireActual("./contract-economic-coverage"),economicDocuments:jest.fn()
}));
jest.mock("../approval/independent-approval-evidence",()=>({recordIndependentApproval:jest.fn(),invalidateIndependentApproval:jest.fn()}));
jest.mock("../approval/ledger-approval-facts",()=>({ledgerApprovalFacts:jest.fn()}));

it.each(["waiting-finance","rollback","finance-finished","contract-only"] as const)(
  "只在合同复核转交财务的原事务入队 (%s)",async phase=>{
    const phases:string[]=[];
    const left={ref:"external:left",projectId:"project",reference:"DOC-A",title:"原文书",counterparty:"合成甲方",
      amountCents:200n,version:"left:1",formal:false,settledCents:0n};
    const right={...left,ref:"external:right",reference:"DOC-B",title:"补充文书",counterparty:"合成乙方",version:"right:1"};
    jest.mocked(economicDocuments).mockResolvedValue([left,right]);
    const financeStage=phase==="finance-finished";
    const row={id:"review",projectId:"project",status:financeStage?"pending_finance":"pending_review",revision:financeStage?2:1,
      preparedByUserId:"applicant",contractReviewedById:financeStage?"prior-director":null,
      leftSourceRef:left.ref,rightSourceRef:right.ref,leftFingerprint:reviewDocumentFingerprint(left),rightFingerprint:reviewDocumentFingerprint(right),
      coverage:[],relation:"independent",financeRequired:phase!=="contract-only",supersedesReviewId:null,frozenSources:null};
    const tx={
      $queryRaw:jest.fn().mockResolvedValue([]),
      contractEconomicSettlementCoverage:{findMany:async()=>[]},
      contractEconomicReview:{findUnique:async()=>row,findUniqueOrThrow:async()=>row,findFirst:async()=>null,findMany:async()=>[],
        update:async({data}:{data:Record<string,unknown>})=>({...row,...data,revision:row.revision+1})}
    };
    const visibility={visibleProjectIdsInTransaction:async()=>["project"],effectiveRoleKeysByProjectInTransaction:async()=>
      new Map([["project",[financeStage?"finance_director":"contract_director"]]])};
    const prisma={$transaction:async(run:(db:typeof tx)=>Promise<unknown>)=>{
      const result=await run(tx);
      if(phase==="rollback")throw new Error("合成提交失败");
      phases.push("commit");return result;
    }};
    const notices={queue:jest.fn().mockImplementation(async()=>{phases.push("queue");}),
      afterCommit:jest.fn().mockImplementation(async()=>{phases.push("dispatch");})};
    const service=new ContractEconomicReviewService(prisma as never,visibility as never,{confirmPassword:async()=>undefined} as never,
      {record:async()=>undefined} as never,{} as never,notices as never);
    const action=()=>service.decide("current","review",{revision:row.revision,decision:"confirm",confirmationPassword:"synthetic"});
    if(phase==="rollback")await expect(action()).rejects.toThrow("合成提交失败");
    else await expect(action()).resolves.toMatchObject({status:phase==="waiting-finance"?"pending_finance":"confirmed"});
    if(phase==="rollback"||phase==="waiting-finance")expect(notices.queue).toHaveBeenCalledWith(tx,
      expect.objectContaining({status:"pending_finance",revision:2,contractReviewedById:"current"}),[left,right]);
    else expect(notices.queue).not.toHaveBeenCalled();
    expect(phases).toEqual(phase==="rollback"?["queue"]:phase==="waiting-finance"?["queue","commit","dispatch"]:["commit"]);
  });
