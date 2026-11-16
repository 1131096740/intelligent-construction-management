import { observeTask12Con18Rounds } from "./task12-con18-round-observer";
const id = (n: number) => `10000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
it("reads both rounds and all signature fields in one read-only transaction", async () => {
  const nodes = Array.from({ length: 5 }, (_, index) => ({ protocolVersion: 1, executionMode: "parallel", roleKeys: [`role-${index}`], mode: "any", approvedRoleKeys: [] }));
  const tx = { $executeRawUnsafe: jest.fn(), approvalInstance: { findMany: jest.fn().mockResolvedValue([{ id:id(1), status:"withdrawn" }, { id:id(2), status:"in_progress", frozenNodes:nodes, currentNodeIndex:0 }]) },
    approvalActionLog: { findMany: jest.fn().mockResolvedValue([{ approvalInstanceId:id(1), signatureFileIdSnapshot:null, signatureSha256Snapshot:null, signatureVersionIdSnapshot:null }]) } };
  const owner = { $transaction: async (fn: (client: typeof tx) => unknown, options: { isolationLevel: string }) => { expect(options.isolationLevel).toBe("RepeatableRead");return fn(tx); } };
  const proof = await observeTask12Con18Rounds(owner as never,id(3),id(1),id(2),()=>undefined);
  expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
  expect(proof).toMatchObject({ oldApproveCount:1, oldSignatureSnapshotsCleared:true, newApproveCount:0, newAllUnsigned:true, newPendingCount:5 });
});

it("requires an actual first-round signed approval with a matching actor", async () => {
  const { observeTask12Con18Signed } = await import("./task12-con18-round-observer");
  const tx = { $executeRawUnsafe: jest.fn(), approvalInstance: { findUnique: jest.fn().mockResolvedValue({ businessType:"contract_version", businessId:id(3), flowType:"contract.approve", status:"in_progress" }) },
    approvalActionLog: { findMany: jest.fn().mockResolvedValue([{ actorUserId:id(4), signatureFileIdSnapshot:id(5), signatureVersionIdSnapshot:id(6), signatureSha256Snapshot:"a".repeat(64) }]) } };
  const owner = { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) };
  await expect(observeTask12Con18Signed(owner as never,id(3),id(1),id(4),()=>undefined)).resolves.toBe(true);
  await expect(observeTask12Con18Signed(owner as never,id(3),id(1),id(7),()=>undefined)).resolves.toBe(false);
  tx.approvalActionLog.findMany.mockResolvedValueOnce([{ actorUserId:id(4), signatureFileIdSnapshot:null, signatureVersionIdSnapshot:id(6), signatureSha256Snapshot:"a".repeat(64) }]);
  await expect(observeTask12Con18Signed(owner as never,id(3),id(1),id(4),()=>undefined)).resolves.toBe(false);
});
