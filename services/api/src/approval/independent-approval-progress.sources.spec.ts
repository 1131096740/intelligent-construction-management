import { Prisma } from "@prisma/client";
import { IndependentApprovalProgressService } from "./independent-approval-progress.service";
import type { PrismaService } from "../database/prisma.service";
import type { ApprovalSmsService } from "./approval-sms.service";
import { SOURCES, INDEPENDENT_REVIEW_LOCK_TABLES } from "./independent-approval-progress.sources";
const at = new Date("2026-10-27T00:00:00Z");
const row = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ id: "item", projectId: "project", createdAt: at, updatedAt: at, ...extra });
type Data = Record<string, Array<Record<string, unknown>>>;
function db(data: Data) {
  const models = Object.fromEntries(Prisma.dmmf.datamodel.models.map(m => [m.name[0].toLowerCase() + m.name.slice(1), m]));
  const check = (name: string, args: Record<string, unknown>) => {
    const fields = new Set(models[name].fields.map(f => f.name));
    const where = (value: Record<string, unknown>) => {
      for (const [key, item] of Object.entries(value)) {
        if (["OR", "AND", "NOT"].includes(key)) {
          for (const branch of Array.isArray(item) ? item : [item])
            where(branch as Record<string, unknown>);
        }
        else
          expect(fields.has(key)).toBe(true);
      }
    };
    if (args.where)
      where(args.where as Record<string, unknown>);
    for (const key of ["select", "orderBy"])
      if (args[key])
        for (const part of Array.isArray(args[key]) ? args[key] as object[] : [args[key] as object])
          for (const field of Object.keys(part)) expect(fields.has(field)).toBe(true);
  };
  const delegates = Object.fromEntries(Object.keys(models).map(name => [
    name, {
      findUnique: jest.fn(async (args: Record<string, unknown>) => { check(name, args); const where = args.where as Record<string, unknown>; return (data[name] ?? []).find(r => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null; }),
      findMany: jest.fn(async (args: Record<string, unknown>) => { check(name, args); return data[name] ?? []; })
    }
  ]));
  return delegates as unknown as Prisma.TransactionClient;
}
const source = (kind: string) => SOURCES.find(s => s.kind === kind)!;
const load = (kind: string, data: Data) => source(kind).load(db(data), "item");
describe("independent review source eligibility", () => {
  it("registers all independent kinds and uses only existing schema selectors", async () => {
    expect(SOURCES).toHaveLength(31);
    const client = db({});
    for (const s of SOURCES) {
      await s.listIds(client);
      expect(await s.load(client, "missing")).toBeNull();
    }
    const models = new Set(Prisma.dmmf.datamodel.models.map(m => m.name));
    for (const name of INDEPENDENT_REVIEW_LOCK_TABLES)
      expect(models.has(name)).toBe(true);
  });
  it.each([
    ["affiliate_contract", "projectAffiliateContractFact", "contract_director"],
    ["affiliate_settlement", "projectAffiliateSettlementFact", "budget_staff"],
    ["affiliate_payment", "projectAffiliatePaymentFact", "finance_staff"],
    ["affiliate_company_contract", "projectAffiliateCompanyContract", "contract_director"],
    ["upstream_settlement", "projectUpstreamSettlement", "budget_staff"],
    ["owner_contract", "projectOwnerContract", "contract_director"]
  ])("projects %s pending facts and excludes drafts", async (kind, model, role) => {
    const data = { [model]: [row({ status: "pending_confirm", recordedByUserId: "author" })] };
    const result = await load(kind, data);
    expect(result?.status).toBe("in_progress");
    expect(result?.nodes[0]).toMatchObject({ scope: "global_or_project", roleKeys: expect.arrayContaining([role]) });
    data[model][0].status = "draft";
    expect(await load(kind, data)).toBeNull();
  });
  it("restricts oral upstream funds to finance director and excludes unreconciled differences", async () => {
    const fact = row({ status: "pending_confirm", recordedByUserId: "author", basisType: "oral", factType: "receipt" });
    expect((await load("upstream_fund", { projectUpstreamFundFact: [fact] }))?.nodes[0].roleKeys).toEqual(["finance_director"]);
    fact.factType = "unreconciled_receipt_difference";
    expect(await load("upstream_fund", { projectUpstreamFundFact: [fact] })).toBeNull();
  });
  it("retains frozen handlers but requires global comprehensive director for governed seal", async () => {
    const data = {
      contractVersion: [row({ contractId: "contract", status: "approved_pending_seal", contractGovernanceVersion: 1 })], contract: [row({ id: "contract", ownerUserId: "author" })], contractSealTask: [row({ id: "task", status: "pending_approval", handlerUserId: "handler" })]
    };
    const result = await load("contract_seal", data);
    expect(result?.nodes[0]).toMatchObject({ scope: "global", roleKeys: ["comprehensive_director"] });
    expect(result?.participantIds).toContain("handler");
    expect(result?.lockTargets).toEqual([{ table: "ContractVersion", id: "item" }, { table: "ContractSealTask", id: "task" }]);
    data.contractVersion[0].status = "draft";
    expect(await load("contract_seal", data)).toBeNull();
  });
  it("targets only current tax stage while retaining later approvers and previous actor", async () => {
    const revision = row({
      status: "pending_contract_confirmation", submittedAt: at, submittedByUserId: "author", contractId: "contract", contractVersionId: "version", financeReviewedByUserId: "former-finance", financeReviewedAt: at
    });
    const result = await load("tax_fact_review", { contractTaxFactRevision: [revision], contract: [row({ id: "contract" })] });
    expect(result?.currentNodeIndex).toBe(1);
    expect(result?.nodes.map(n => n.status)).toEqual(["已通过", "处理中"]);
    expect(result?.history[0].actorUserId).toBe("former-finance");
  });
  it("routes each takeover correction scope using the current domain reviewer policy", async () => {
    const correction = row({
      status: "submitted", submittedAt: at, createdByUserId: "creator", takeoverId: "takeover", correctionScope: "historical_settlement"
    });
    const data = {
      contractTakeoverCorrection: [correction], contractTakeover: [row({ id: "takeover", takeoverStatus: "confirmed", contractId: "contract" })], contract: [row({ id: "contract" })]
    };
    expect((await load("takeover_correction", data))?.nodes[0]).toMatchObject({ roleKeys: ["contract_director"], excludeUserIds: undefined });
    correction.correctionScope = "historical_payment";
    expect((await load("takeover_correction", data))?.nodes[0].roleKeys).toEqual(["finance_director"]);
  });
  it("keeps independent department pending confirmations and suppresses stale finance basis", async () => {
    const contractFacts = {
      takeoverId: "item", revision: 2, financeBasisRevision: 2, confirmedRevision: null, updatedByUserId: "contract-author", updatedAt: at
    };
    const financeFacts = {
      takeoverId: "item", revision: 1, basedOnContractRevision: 2, basedOnFinanceBasisRevision: 2, confirmedRevision: null, updatedByUserId: "finance-author", updatedAt: at
    };
    const data = {
      contractTakeover: [row({ contractId: "contract", createdByUserId: "author" })], contract: [row({ id: "contract" })], contractTakeoverContractFacts: [contractFacts], contractTakeoverFinanceFacts: [financeFacts]
    };
    expect((await load("takeover_contract_confirmation", data))?.status).toBe("in_progress");
    expect((await load("takeover_finance_confirmation", data))?.status).toBe("in_progress");
    financeFacts.basedOnFinanceBasisRevision = 1;
    expect((await load("takeover_contract_confirmation", data))?.nodes[1].status).toBe("未开始");
    expect((await load("takeover_finance_confirmation", data))?.nodes[0].status).toBe("未开始");
  });
  it("does not remind material directors for a replaced receipt version", async () => {
    const procurement = row({ id: "procurement", status: "approved_in_progress", currentVersionId: "version", handlerUserId: "handler" });
    const data = {
      spotProcurementReceipt: [
        row({
          procurementId: "procurement", procurementVersionId: "version", status: "submitted", submittedAt: at, firstSubmittedAt: at, handlerUserId: "handler", currentRevisionNo: 1
        })
      ], spotProcurement: [procurement], spotProcurementVersion: [row({ id: "version", status: "approved", handlerUserId: "handler" })], spotProcurementReceiptRevision: [row({ receiptId: "item", revisionNo: 1, procurementVersionId: "version", handlerUserId: "handler", submittedAt: at })]
    };
    expect((await load("receipt_review", data))?.status).toBe("in_progress");
    procurement.currentVersionId = "replacement";
    expect((await load("receipt_review", data))?.nodes[0].status).toBe("未开始");
  });
  it.each(["no_invoice", "invoice_exception"])("does not remind retired real-form %s reviews", async (kind) => {
    const model = kind === "no_invoice" ? "noInvoiceConfirmation" : "invoiceExceptionConfirmation";
    const payment = row({ paymentType: null });
    const data = {
      [model]: [
        row({
          status: "pending_review", procurementId: "procurement", receiptId: "receipt", procurementVersionId: "version", receiptRevisionNo: 1, procurementLineId: "line"
        })
      ], spotProcurement: [row({ id: "procurement", status: "approved_in_progress", currentVersionId: "version" })], spotProcurementReceipt: [row({ id: "receipt", status: "reviewed", currentRevisionNo: 1, procurementVersionId: "version" })], spotProcurementVersion: [row({ id: "version", status: "approved" })], spotProcurementReceiptLine: [row({ procurementLineId: "line" })], spotProcurementPayment: [payment], spotProcurementReceiptRevision: [row({ receiptId: "receipt", procurementId: "procurement", procurementVersionId: "version", revisionNo: 1 })], spotProcurementReceiptReview: [row({ receiptId: "receipt", receiptRevisionNo: 1, procurementVersionId: "version", decision: "approved", sequenceNo: 1 })]
    };
    expect((await load(kind, data))?.status).toBe("in_progress");
    payment.paymentType = "normal";
    expect((await load(kind, data))?.nodes[0].status).toBe("未开始");
  });
  it("only permits business repayment confirmation for project loan accounts", async () => {
    const account = row({ id: "account", scopeKey: "project:project", userId: "borrower" });
    const data = {
      employeeLoanRepayment: [row({ status: "recorded", recordedByUserId: "recorder", loanAccountId: "account" })], employeeProjectLoanAccount: [account]
    };
    expect((await load("loan_repayment", data))?.participantIds).toContain("borrower");
    account.scopeKey = "company:company";
    expect(await load("loan_repayment", data)).toBeNull();
  });
  it.each([
    ["contract_template", "contractBusinessTemplateVersion", "contractBusinessTemplate", "templateId"],
    ["layout_template", "contractLayoutTemplateVersion", "contractLayoutTemplate", "layoutTemplateId"],
    ["standard_clause", "standardClauseVersion", "standardClause", "clauseId"],
    ["settlement_template", "settlementTemplateVersion", "settlementTemplate", "settlementTemplateId"]
  ])("preserves %s technical publication policy without exposing drafts", async (kind, model, parent, key) => {
    const version = row({ status: "submitted", submittedByUserId: "author", [key]: "parent" });
    const data = { [model]: [version], [parent]: [row({ id: "parent" })] };
    const result = await load(kind, data);
    expect(result?.nodes[0].scope).toBe("global");
    expect(result?.nodes[0].roleKeys.includes("super_admin")).toBe(kind === "settlement_template");
    version.status = "draft";
    expect(await load(kind, data)).toBeNull();
  });
  it("loads both archive confirmation mechanisms against the real schema", async () => {
    const contract = await load("contract_archive", {
      contractVersion: [row({ contractId: "contract", status: "pending_archive_confirm", contractGovernanceVersion: 1 })], contract: [row({ id: "contract", ownerUserId: "author" })], contractFormalFile: [row({ uploadedByUserId: "handler", status: "active" })], contractSealTask: [row({ status: "completed", handlerUserId: "handler" })]
    });
    expect(contract?.status).toBe("in_progress");
    expect(contract?.nodes[0].scope).toBe("global");
    const settlement = await load("settlement_archive", {
      settlement: [row({ status: "pending_archive_confirm", preparedByUserId: "author" })], settlementArchiveFile: [row({ uploadedByUserId: "handler", status: "pending_confirm" })], settlementSignedDocument: [row({ uploadedByUserId: "handler" })]
    });
    expect(settlement?.status).toBe("in_progress");
    expect(settlement?.nodes[0]).toMatchObject({ scope: "global_or_project", roleKeys: ["contract_director"] });
  });
  it("includes submitted legacy takeover reviews and excludes unsent drafts", async () => {
    const takeover = row({ contractId: "contract", takeoverStatus: "pending_review", submittedByUserId: "author", submittedAt: at });
    const data = { contractTakeover: [takeover], contract: [row({ id: "contract" })] };
    expect((await load("takeover_review", data))?.status).toBe("in_progress");
    takeover.takeoverStatus = "draft";
    takeover.submittedAt = null;
    expect(await load("takeover_review", data)).toBeNull();
  });
  it("only reminds finance for an open requested abnormal termination", async () => {
    const procurement = row({ id: "procurement", status: "approved_in_progress" });
    const data = {
      spotProcurementAbnormalTermination: [row({ status: "requested", requestedByUserId: "requester", procurementId: "procurement" })], spotProcurement: [procurement]
    };
    expect((await load("abnormal_termination", data))?.nodes[0]).toMatchObject({ status: "处理中", roleKeys: ["finance_director"] });
    procurement.status = "closed";
    expect((await load("abnormal_termination", data))?.nodes[0].status).toBe("未开始");
  });
  it("includes batch acceptance review and historical reviewers", async () => {
    const data = {
      contractTakeoverBatch: [row({ status: "under_review", createdByUserId: "importer", responsibleUserId: "responsible", batchNo: "B1" })], auditLog: [row({ actorUserId: "previous-reviewer" })]
    };
    const result = await load("takeover_batch_review", data);
    expect(result?.status).toBe("in_progress");
    expect(result?.participantIds).toContain("previous-reviewer");
    expect(result?.history[0].action).toBe("批次复核");
  });
  it("excludes a final-contract uploader from confirmation unless also the designated handler", async () => {
    const task = row({ status: "completed", handlerUserId: "handler" });
    const data = {
      contractVersion: [row({ contractId: "contract", status: "pending_archive_confirm", contractGovernanceVersion: 1 })], contract: [row({ id: "contract" })], contractFormalFile: [row({ uploadedByUserId: "uploader", status: "active" })], contractSealTask: [task]
    };
    expect((await load("contract_archive", data))?.nodes[0].excludeUserIds).toEqual(["uploader"]);
    task.handlerUserId = "uploader";
    expect((await load("contract_archive", data))?.nodes[0].excludeUserIds).toEqual([]);
  });
  it("restricts oral affiliate payments to directors while written facts include finance staff",async()=>{
    const fact=row({status:"pending_confirm",recordedByUserId:"author",basisType:"written"});
    const data={projectAffiliatePaymentFact:[fact]};
    expect((await load("affiliate_payment",data))?.nodes[0].roleKeys).toEqual(["finance_staff","finance_director"]);
    fact.basisType="oral";expect((await load("affiliate_payment",data))?.nodes[0].roleKeys).toEqual(["finance_director"]);
  });
  it("preserves stopped publication as cancelled even when it previously published",async()=>{
    const result=await load("standard_clause",{standardClauseVersion:[row({status:"stopped",clauseId:"parent",submittedByUserId:"author",publishedAt:at,publishedByUserId:"publisher"})],standardClause:[row({id:"parent"})]});
    expect(result?.status).toBe("cancelled");expect(result?.nodes[0].status).toBe("未执行");expect(result?.history[0].action).toBe("审核发布");
  });

  it.each([
    ["contract_seal","contract_version","contract.seal.approve","同意用章"],
    ["contract_archive","contract_version","contract.formal_file.return_correction","归档退回补正"],
    ["takeover_review","contract_takeover","contract_takeover.return_for_supplement","退回补充"]
  ])("lets a former actual %s reviewer read history without restoring review authority",async(kind,businessType,action,label)=>{
    const data:Data={
      contractVersion:[row({contractId:"contract",status:"seal_approved_pending_archive",contractGovernanceVersion:null})],
      contract:[row({id:"contract",ownerUserId:"author"})],
      contractTakeover:[row({contractId:"contract",takeoverStatus:"needs_supplement",submittedAt:at,createdByUserId:"author"})],
      auditLog:[row({id:"audit",businessType,businessId:"item",action,actorUserId:"former-reviewer",metadata:{reason:"请补齐"}}),row({id:"download",businessType,businessId:"item",action:"file.download",actorUserId:"reader"}),row({id:"foreign",businessType,businessId:"another",action,actorUserId:"foreign-reviewer"})],
      user:[row({id:"former-reviewer",name:"离任审批人",isActive:true}),row({id:"reader",name:"文件读取人",isActive:true}),row({id:"foreign-reviewer",isActive:true})],
      project:[row({id:"project",name:"本地项目"})]
    };
    const service=new IndependentApprovalProgressService(db(data) as unknown as PrismaService,{available:()=>false} as ApprovalSmsService);
    const detail=await service.detail(`independent:${kind}:item`,"former-reviewer");
    expect(detail.history.some(event=>event.actor.id==="former-reviewer"&&event.action===label)).toBe(true);
    expect(detail.pendingRecipients).toEqual([]);
    expect(detail.nodes.flatMap(node=>node.participants).some(person=>person.id==="former-reviewer")).toBe(false);
    await expect(service.detail(`independent:${kind}:item`,"reader")).rejects.toThrow("无权查看");
    await expect(service.detail(`independent:${kind}:item`,"foreign-reviewer")).rejects.toThrow("无权查看");
  });

});

describe('latest-main independent approval sources', () => {
  it.each([
    ['contract_bank_verification','contractBankVerificationRequest','finance_director','global'],
    ['contract_proxy_execution','contractProxyExecution','finance_director','global_or_project'],
    ['upward_contract_amount_revision','upwardContractAmountRevision','contract_director','global_or_project'],
    ['upward_receipt_match','upwardReceiptMatch','finance_director','global_or_project']
  ])('%s preserves actual confirmer scope, self-review exclusion and active-project gate', async(kind,model,role,scope)=>{
    const record=row({status:'pending_confirm',recordedByUserId:'author'});
    const project=row({id:'project',isActive:true});
    const data={[model]:[record],project:[project]};
    const pending=await load(kind,data);
    expect(pending?.nodes[0]).toMatchObject({roleKeys:[role],scope,excludeUserIds:['author'],status:'处理中'});
    expect(pending?.requiresActiveProject).toBe(true);
    expect(pending?.lockTargets[0]).toEqual({table:'Project',id:'project'});
    project.isActive=false;
    expect((await load(kind,data))?.nodes[0].status).toBe('未开始');
    record.status='returned';
    expect((await load(kind,data))?.status).toBe('rejected');
    record.status='draft';
    expect(await load(kind,data)).toBeNull();
  });
  it('economic review targets finance only after contract approval and excludes both preparer and first reviewer',async()=>{
    const record=row({status:'pending_review',financeRequired:true,preparedByUserId:'author'});
    const data={contractEconomicReview:[record],project:[row({id:'project',isActive:true})]};
    const first=await load('contract_economic_review',data);
    expect(first?.nodes.map(n=>n.status)).toEqual(['处理中','未开始']);
    record.status='pending_finance';record.contractReviewedById='first-reviewer';
    const second=await load('contract_economic_review',data);
    expect(second?.currentNodeIndex).toBe(1);
    expect(second?.nodes[1]).toMatchObject({roleKeys:['finance_director'],excludeUserIds:['author','first-reviewer'],status:'处理中'});
    record.status='superseded';
    expect((await load('contract_economic_review',data))?.status).toBe('cancelled');
  });
  it('employee referral uses real global managers and resubmission returns to first review without inventing an applicant account',async()=>{
    const record=row({status:'chairman_review',proposedRoles:['finance_director']});
    const data={employeeRegistration:[record],auditLog:[row({businessType:'employee_registration',businessId:'item',action:'employee.registration.refer',actorUserId:'former-manager'})]};
    const referred=await load('employee_registration',data);
    expect(referred?.currentNodeIndex).toBe(1);
    expect(referred?.nodes[1]).toMatchObject({roleKeys:['chairman'],scope:'global',status:'处理中'});
    expect(referred?.applicantUserId).toBe('');
    expect(referred?.history[0].actorUserId).toBe('former-manager');
    record.status='pending';
    const resumed=await load('employee_registration',data);
    expect(resumed?.currentNodeIndex).toBe(0);
    expect(resumed?.nodes.map(n=>n.status)).toEqual(['处理中','未开始']);
    expect(resumed?.nodes[0].roleKeys).toEqual(['comprehensive_director','chairman']);
  });
});
