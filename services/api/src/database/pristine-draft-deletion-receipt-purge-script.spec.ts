import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ReceiptPurgeModule = {
  RECEIPT_PURGE_BATCH_SIZE: number;
  parseArgs(argv: string[]): void;
  purgeExpiredPristineDraftDeletionReceipts(
    prisma: {
      contractPristineDraftDeletionReceipt: {
        findMany: jest.Mock;
        deleteMany: jest.Mock;
      };
    },
    now: Date
  ): Promise<{ scannedCount: number; deletedCount: number }>;
};

const requireFromHere = createRequire(__filename);
const scriptPath = resolve(
  __dirname,
  "../../scripts/purge-pristine-draft-deletion-receipts.cjs"
);

function loadScript(): ReceiptPurgeModule {
  return requireFromHere(scriptPath) as ReceiptPurgeModule;
}

describe("pristine draft deletion receipt purge", () => {
  it("purges only completed receipts whose expiry has passed", async () => {
    const tool = loadScript();
    const now = new Date("2026-08-08T00:00:00.000Z");
    const prisma = {
      contractPristineDraftDeletionReceipt: {
        findMany: jest.fn().mockResolvedValue([
          { contractVersionId: "expired-1" },
          { contractVersionId: "expired-2" }
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 })
      }
    };

    await expect(
      tool.purgeExpiredPristineDraftDeletionReceipts(prisma, now)
    ).resolves.toEqual({ scannedCount: 2, deletedCount: 2 });
    expect(prisma.contractPristineDraftDeletionReceipt.findMany).toHaveBeenCalledWith({
      where: { status: "completed", expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { contractVersionId: "asc" }],
      take: tool.RECEIPT_PURGE_BATCH_SIZE,
      select: { contractVersionId: true }
    });
    expect(prisma.contractPristineDraftDeletionReceipt.deleteMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: { in: ["expired-1", "expired-2"] },
        status: "completed",
        expiresAt: { lte: now }
      }
    });
  });

  it("requires the dedicated timer command", () => {
    const tool = loadScript();
    expect(() => tool.parseArgs(["--timer-approved-receipt-purge"])).not.toThrow();
    expect(() => tool.parseArgs([])).toThrow();
    expect(() => tool.parseArgs(["--timer-approved-receipt-purge", "--apply"])).toThrow();
  });

  it("installs a disabled-by-default daily production timer", () => {
    const service = readFileSync(resolve(
      __dirname,
      "../../../../scripts/ops/systemd/jiangkong-pristine-draft-deletion-receipt-purge.service"
    ), "utf8");
    const timer = readFileSync(resolve(
      __dirname,
      "../../../../scripts/ops/systemd/jiangkong-pristine-draft-deletion-receipt-purge.timer"
    ), "utf8");
    const deploy = readFileSync(resolve(
      __dirname,
      "../../../../scripts/ops/deploy-production-server.sh"
    ), "utf8");

    expect(service).toContain(
      "CONTRACT_PRISTINE_DRAFT_DELETION_RECEIPT_PURGE_ENABLED=true"
    );
    expect(service).toContain(
      "purge-pristine-draft-deletion-receipts.cjs --timer-approved-receipt-purge"
    );
    expect(timer).toContain("OnCalendar=*-*-* 05:00:00");
    expect(deploy).toContain("install_pristine_draft_receipt_purge_units");
    expect(deploy).toContain("without enabling or starting the timer");
  });
});
