import type { Prisma } from "@prisma/client";
import { insertDirectPendingOriginals } from "./contract-direct-pending-originals";

describe("insertDirectPendingOriginals", () => {
  const slotKey = "direct_signed_originals_v1";
  const originals = [
    { slotKey, fileId: "first-original", displayOrder: 0 },
    { slotKey, fileId: "second-original", displayOrder: 1 }
  ];

  it("inserts only the authorized columns in order and leaves createdAt to PostgreSQL", async () => {
    const executeRaw = jest.fn().mockResolvedValue(2);
    await insertDirectPendingOriginals({ $executeRaw: executeRaw }, "version", "applicant", originals);

    expect(executeRaw).toHaveBeenCalledTimes(1);
    const statement: Prisma.Sql = executeRaw.mock.calls[0][0];
    expect(statement.sql).toContain(
      'INSERT INTO "public"."ContractDraftAttachment" ("id","contractVersionId","slotKey","fileId","displayOrder","createdByUserId")'
    );
    expect(statement.sql).not.toContain("createdAt");
    expect(statement.values).toEqual(originals.flatMap(({ fileId, displayOrder }) => [
      expect.stringMatching(/^[a-f0-9-]{36}$/u), "version", slotKey, fileId, displayOrder, "applicant"
    ]));
    expect(statement.values[0]).not.toBe(statement.values[6]);
  });

  it("leaves insert failures to the caller's transaction", async () => {
    const error = new Error("insert rejected");
    const executeRaw = jest.fn().mockRejectedValue(error);
    await expect(insertDirectPendingOriginals({ $executeRaw: executeRaw }, "version", "applicant", originals))
      .rejects.toBe(error);
  });
});
