const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const {
  PRECISION_SENTINEL_CENTS,
  assertLocalMoneyVerificationRuntime
} = require("../dist/database/money-bigint-live-verification");

async function main() {
  assertLocalMoneyVerificationRuntime({
    databaseUrl: process.env.DATABASE_URL ?? "",
    apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:3000",
    storageDriver: process.env.FILE_STORAGE_DRIVER ?? "local"
  });

  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) {
    throw new Error("本地大额金额验收缺少随机 SEED_PASSWORD");
  }
  const passwordHash = await bcrypt.hash(seedPassword, 10);

  const prisma = new PrismaClient();
  try {
    const result = await prisma.user.updateMany({
      where: { id: { startsWith: "seed-user-" } },
      data: { passwordHash, mustChangePassword: false }
    });
    if (result.count < 10) {
      throw new Error(`本地验收 seed 账号数量异常：${result.count}`);
    }
    const ownerContract = await prisma.projectOwnerContract.updateMany({
      where: { projectId: "seed-project-jgxm-001", status: "effective" },
      data: { amountCents: BigInt(PRECISION_SENTINEL_CENTS) }
    });
    if (ownerContract.count !== 1) {
      throw new Error(`本地验收业主主合同数量异常：${ownerContract.count}`);
    }
    const upstreamSettlement = await prisma.projectUpstreamSettlement.updateMany({
      where: { projectId: "seed-project-jgxm-001", voidedAt: null },
      data: {
        reportedAmountCents: BigInt(PRECISION_SENTINEL_CENTS),
        approvedAmountCents: BigInt(PRECISION_SENTINEL_CENTS)
      }
    });
    if (upstreamSettlement.count !== 1) {
      throw new Error(`本地验收上游结算数量异常：${upstreamSettlement.count}`);
    }
    console.log(`本地临时库已放行 ${result.count} 个 seed 验收账号；生产 seed 规则未修改`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
