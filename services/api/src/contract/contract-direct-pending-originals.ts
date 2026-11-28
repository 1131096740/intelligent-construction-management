import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { SaveContractDraftAttachmentDto } from "../contract-workbench/dto/contract-workbench.dto";

export async function insertDirectPendingOriginals(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  contractVersionId: string,
  actorUserId: string,
  originals: readonly SaveContractDraftAttachmentDto[]
): Promise<void> {
  // The ordinary draft role can insert only business columns. PostgreSQL supplies createdAt.
  const values = originals.map(file => Prisma.sql`(
    ${randomUUID()}, ${contractVersionId}, ${file.slotKey}, ${file.fileId}, ${file.displayOrder}, ${actorUserId}
  )`);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "public"."ContractDraftAttachment" ("id","contractVersionId","slotKey","fileId","displayOrder","createdByUserId")
    VALUES ${Prisma.join(values)}
  `);
}
