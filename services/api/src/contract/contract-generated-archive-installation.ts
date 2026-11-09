import type { Prisma } from "@prisma/client";

export type GeneratedArchiveSealFile = { fileId: string; mimeType: string; sizeBytes: number; contentSha256: string };

export type GeneratedArchiveSealScope = Readonly<{
  relationship: "outside" | "upward";
  projectId: string;
  contractId: string;
  contractVersionId: string;
  approvalInstanceId: string;
  sealTaskId: string;
  handlerUserId: string;
  actorUserId: string;
  documentContentRevision: number;
  documentContentFingerprint: string;
  sourceRevision: number;
  layoutTemplateVersionId: string;
  sourceSha256: string;
  signingIdentity: Readonly<Record<string, unknown>>;
  generatedDocumentId: string;
  files: readonly [GeneratedArchiveSealFile, GeneratedArchiveSealFile];
}>;

export type GeneratedArchiveSealAuthority = {
  transaction: Prisma.TransactionClient;
  scope: GeneratedArchiveSealScope;
  installation: {
    databaseOid: string;
    namespaceOid: string;
    currentRoleOid: string;
    sessionRoleOid: string;
    archiveWriterOid: string;
    signedFileAuthorityOid: string;
    archiveReceiptReaderOid: string;
    operatingAuthorityOid: string;
    backendPid: number;
    transactionId: string;
  };
};

/** Only an installed archive authority can produce this evidence. The source candidate has no producer. */
export const readGeneratedArchiveSealAuthority: (
  tx: Prisma.TransactionClient,
  scope: GeneratedArchiveSealScope
) => Promise<GeneratedArchiveSealAuthority | null> = async () => null;
