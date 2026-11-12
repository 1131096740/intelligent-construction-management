import type { PrismaService } from "../database/prisma.service";
import { fundReviewWorkItems } from "./fund-account-work-items";

it("lists correction duties using only fields in the base balance registration", async () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const tx = { fundAccountBalanceRegistration: { findMany } };
  const prisma = {
    ...tx,
    $transaction: async (read: (connection: typeof tx) => Promise<unknown>) => read(tx)
  } as unknown as PrismaService;

  await expect(fundReviewWorkItems(prisma, "reviewer")).resolves.toEqual([]);
  expect(findMany).toHaveBeenCalledWith({
    where: { kind: "correction", status: "pending_review" },
    orderBy: { createdAt: "desc" },
    select: { id: true, approvalInstanceId: true, balanceYuan: true }
  });
});
