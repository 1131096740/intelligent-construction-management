import { Prisma } from "@prisma/client";
import { contractReminderIntent, expenseReminderIntent, independentFinancialReminderIntent, paymentReminderIntent } from "./approval-reminder-business-intent";

const scope = {projectId:"project-a",projectName:"合成项目",applicantName:"原申请人",businessLabel:"事项催办",dutyName:"当前岗位"};
const contract = {projectId:"project-a",code:"HT-01",name:"合成合同",companyEntityName:"合成公司",counterparty:"合成供应商"};
const version = {contractId:"contract-a",companyEntityNameSnapshot:"原冻结公司",amountYuan:new Prisma.Decimal("10.0001"),amountCents:1000n,amountLimitType:"capped"};
const payment = {id:"payment-a",projectId:"project-a",code:"FK-01",contractId:"contract-a",contractVersionId:"version-a",
  settlementId:"settlement-a",paymentMatter:"材料付款",requestedAmountCents:501n,paidAmountCents:133n};
const claim = {id:"claim-a",projectId:null,code:"BX-01",claimType:"reimbursement",reason:"办公费用",applicantNameSnapshot:"原申请人员",
  companyEntityNameSnapshot:"实际公司",payeeNameSnapshot:null,requestedAmountCents:225n};

function client() {
  return {
    contract:{findUnique:jest.fn(async()=>contract)},
    contractVersion:{findUnique:jest.fn(async()=>version)},
    paymentRequest:{findUnique:jest.fn(async()=>payment)},
    settlement:{findUnique:jest.fn(async()=>({finalCumulativeAmountCents:1001n,payableAmountCents:601n}))},
    expenseClaim:{findUnique:jest.fn(async()=>claim)},
    expenseClaimLine:{findMany:jest.fn(async()=>[{expenseCategory:"材料",amountCents:225n}])},
  };
}

it("uses the exact authorized contract version and preserves four-place facts", async()=>{
  const db = client();
  expect(await contractReminderIntent(db as unknown as Prisma.TransactionClient,"version-a",scope)).toMatchObject({
    subject:"合成合同",participants:["原冻结公司","合成供应商"],amountText:"10.0001 元",targetPath:"/合同管理/HT-01",
  });
  db.contractVersion.findUnique.mockResolvedValue({...version,amountLimitType:"uncapped"});
  expect((await contractReminderIntent(db as unknown as Prisma.TransactionClient,"version-a",scope))?.amountText).toBe("金额待确定");
  expect(await contractReminderIntent(db as unknown as Prisma.TransactionClient,"version-a",{...scope,projectId:"elsewhere"})).toBeNull();
});

it("requests only the payment's own settlement under its frozen project and contract", async()=>{
  const db = client();
  expect(await paymentReminderIntent(db as unknown as Prisma.TransactionClient,"payment-a",scope)).toMatchObject({
    subject:"材料付款",amountText:"5.01 元",details:["本申请已付 1.33 元","关联累计结算 10.01 元"],targetPath:"/付款管理/payment-a",
  });
  expect(db.settlement.findUnique).toHaveBeenCalledWith(expect.objectContaining({
    where:{id:"settlement-a",projectId:"project-a",contractId:"contract-a"},
  }));
  db.contractVersion.findUnique.mockResolvedValue({...version,contractId:"different"});
  expect(await paymentReminderIntent(db as unknown as Prisma.TransactionClient,"payment-a",scope)).toBeNull();
});

it("preserves company daily scope and extracts only bounded reimbursement fact lines", async()=>{
  const db = client();
  expect(await expenseReminderIntent(db as unknown as Prisma.TransactionClient,"claim-a",{...scope,projectId:null,projectName:undefined})).toMatchObject({
    scopeName:"公司日常",initiatorName:"原申请人员",participants:["实际公司"],amountText:"2.25 元",details:["材料 2.25 元"],
    targetPath:"/费用与报销/claim-a",
  });
  expect(db.expenseClaimLine.findMany).toHaveBeenCalledWith({where:{expenseClaimId:"claim-a"},select:{expenseCategory:true,amountCents:true},orderBy:{sortOrder:"asc"},take:3});
  expect(await expenseReminderIntent(db as unknown as Prisma.TransactionClient,"claim-a",scope)).toBeNull();
});

it("independent financial summaries expose only the scoped aggregate facts", async()=>{
  const banks = {findUnique:jest.fn(async()=>({projectId:"project-a",status:"pending_confirm",companyName:"合成主体",direction:"inflow",amountCents:1001n}))};
  const proxies = {findUnique:jest.fn(async()=>({projectId:"project-a",status:"pending_confirm",entryKind:"repayment",amountCents:602n,
    frozenSource:{debtor:{name:"原债务方"},payee:{name:"原收款方"},actualPayer:{name:"过往付款人"}}}))};
  const prisma={...client(),contractBankVerificationRequest:banks,contractProxyExecution:proxies,
    employeeLoanRepayment:{findUnique:async()=>({loanAccountId:"loan",status:"recorded",amountCents:501n})},
    employeeProjectLoanAccount:{findUnique:async()=>({scopeKey:"project:project-a",userId:"borrower"})},
    user:{findUnique:async()=>({name:"原借款人"})},
  } as unknown as Prisma.TransactionClient;
  expect(await independentFinancialReminderIntent(prisma,"contract_bank_verification","bank-1",scope,"银行流水核验")).toMatchObject({
    subject:"银行到账核验",participants:["合成主体"],amountText:"10.01 元",
    targetPath:"/审批中心?review=independent%3Acontract_bank_verification%3Abank-1",
  });
  expect(banks.findUnique).toHaveBeenCalledWith({where:{id:"bank-1"},select:{projectId:true,status:true,companyName:true,direction:true,amountCents:true}});
  expect(await independentFinancialReminderIntent(prisma,"contract_proxy_execution","proxy-1",scope,"代付及往来确认")).toMatchObject({
    subject:"代付归还核对",participants:["原债务方","原收款方"],amountText:"6.02 元",
  });
  expect(await independentFinancialReminderIntent(prisma,"loan_repayment","repay-1",scope,"员工还款")).toMatchObject({
    participants:["原借款人"],amountText:"5.01 元",targetPath:"/审批中心?review=independent%3Aloan_repayment%3Arepay-1",
  });
  await expect(independentFinancialReminderIntent(prisma,"loan_repayment","repay-1",{...scope,projectId:"other"},"员工还款")).resolves.toBeNull();
  await expect(independentFinancialReminderIntent(prisma,"contract_proxy_execution","proxy-1",{...scope,projectId:"other"},"代付")).resolves.toBeNull();
});
