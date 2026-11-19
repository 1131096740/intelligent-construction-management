import { Prisma } from "@prisma/client";
import { availableRegisteredBalance } from "../payment/registered-payment-funding";

it("retains both covered and uncovered cent payments when a new four-place principal debit changes the snapshot", async () => {
  const accountId = "company-account";
  const priorId = "prior-registration";
  const currentId = "principal-return-registration";
  const priorSource = { id:"prior-source",registrationId:priorId,previousSourceBatchId:null };
  const nextSource = { id:"next-source",registrationId:currentId,previousSourceBatchId:priorSource.id,
    amountYuan:new Prisma.Decimal("90.0000").minus("10.0001") };
  const tx = {
    registeredFundPaymentAllocation:{findMany:async()=>[
      {executionId:"included-cent-payment",sourceBatchId:priorSource.id,amountCents:1000n},
      {executionId:"uncovered-cent-payment",sourceBatchId:priorSource.id,amountCents:1001n},
    ]},
    fundAccountBalanceRegistration:{findMany:async()=>[{id:priorId},{id:currentId}]},
    fundAccountSourceBatch:{findMany:async()=>[priorSource,nextSource]},
    registeredFundTransferLine:{findMany:async()=>[]},
  } as unknown as Prisma.TransactionClient;
  const balance = await availableRegisteredBalance(tx,{
    id:currentId,accountId,coveredExecutionIds:["included-cent-payment"],
    balanceYuan:new Prisma.Decimal("90.0000").minus("10.0001"),sources:[nextSource],
  } as unknown as Parameters<typeof availableRegisteredBalance>[1]);

  expect(balance.balanceYuan?.toFixed(4)).toBe("69.9899");
  expect(balance.sources[0].amountYuan.toFixed(4)).toBe("69.9899");
  expect(balance.pendingAllocations).toEqual([]);
});
