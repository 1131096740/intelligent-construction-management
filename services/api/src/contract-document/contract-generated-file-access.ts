import { ForbiddenException } from "@nestjs/common";
import type { ModuleRef } from "@nestjs/core";
import type { FileObject, Prisma } from "@prisma/client";
import { CONTRACT_VERSION_FILE_READ_AUTHORITY, type ContractVersionFileReadAuthority } from "../contract/contract-version-file-read-authority";

/** False means unbound. A known document binding can never use the uploader shortcut. */
export async function assertGeneratedContractFileAccess(
  tx: Prisma.TransactionClient,
  file: Pick<FileObject, "id" | "mimeType">,
  actorUserId: string,
  moduleRef?: Pick<ModuleRef, "get">
): Promise<boolean> {
  const documents = await tx.contractGeneratedDocument.findMany({ where: { OR: [{ docxFileId: file.id }, { pdfFileId: file.id }] }, take: 2 });
  if (!documents.length) return false;
  const denied = () => new ForbiddenException("当前账号无权读取该合同文档");
  if (documents.length !== 1) throw denied();
  const document = documents[0];
  if (!["success", "stale", "superseded"].includes(document.status) || !document.docxFileId || !document.pdfFileId || document.docxFileId === document.pdfFileId) throw denied();
  const expectedType = file.id === document.pdfFileId ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (file.mimeType !== expectedType || !moduleRef) throw denied();
  let authority: ContractVersionFileReadAuthority;
  try { authority = moduleRef.get<ContractVersionFileReadAuthority>(CONTRACT_VERSION_FILE_READ_AUTHORITY, { strict: false }); }
  catch { throw denied(); }
  if (!authority || typeof authority.assertCanReadVersionFile !== "function") throw denied();
  try { await authority.assertCanReadVersionFile(tx, document.contractVersionId, actorUserId); }
  catch { throw denied(); }
  return true;
}
