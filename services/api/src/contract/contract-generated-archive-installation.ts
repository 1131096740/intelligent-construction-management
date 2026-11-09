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

export type GeneratedArchiveSignedOriginal = Readonly<{
  fileId: string;
  displayOrder: number;
  bucket: string;
  objectKey: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  contentSha256: string;
  objectGeneration: string;
}>;

/** scope.actorUserId identifies the seal confirmer. */
export type GeneratedArchiveRequestBinding = Readonly<{
  protocolVersion: 1;
  archiveSource: "generated_approval";
  scope: GeneratedArchiveSealScope;
  uploaderUserId: string;
  idempotencyKey: string;
  requestSha256: string;
  originals: readonly GeneratedArchiveSignedOriginal[];
}>;

type GeneratedArchiveBindingWitness = Readonly<{
  transaction: Prisma.TransactionClient;
  installation: GeneratedArchiveSealAuthority["installation"];
  binding: GeneratedArchiveRequestBinding;
}>;

/**
 * The installed authority reads the exact attestation inside the caller's transaction.
 * The request supplies lookup coordinates. The authority must verify them independently.
 */
export const readGeneratedArchiveRequestBinding: (
  tx: Prisma.TransactionClient,
  binding: GeneratedArchiveRequestBinding
) => Promise<GeneratedArchiveBindingWitness | null> = async () => null;

export type GeneratedArchiveCompletion = Readonly<{
  protocolVersion: 1;
  policy: "operating_ledger_not_enabled";
  archiveId: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  approvalInstanceId: string;
  sealTaskId: string;
  uploaderUserId: string;
  idempotencyKey: string;
  requestSha256: string;
  authoritySha256: string;
  fileManifestSha256: string;
  archivedAt: string;
  evidenceIds: readonly string[];
  originals: readonly GeneratedArchiveSignedOriginal[];
}>;

export type GeneratedArchiveWriterAuthority = Readonly<{
  transaction: Prisma.TransactionClient;
  installation: GeneratedArchiveSealAuthority["installation"];
  binding: GeneratedArchiveRequestBinding;
  // Fixed originals are appended before activation. Completion is captured independently after activation and audit.
  appendOriginals: (command: GeneratedArchiveCompletion) => Promise<void>;
  appendCompletion: (archiveId: string) => Promise<void>;
}>;

/** A successor installer must independently qualify the writer, including its database activation and pin permissions. */
export const readGeneratedArchiveWriterAuthority: (
  tx: Prisma.TransactionClient,
  binding: GeneratedArchiveRequestBinding
) => Promise<GeneratedArchiveWriterAuthority | null> = async () => null;

/** Read an installed immutable completion by ID. Never derive it from the lookup request. */
export const readGeneratedArchiveCompletion: (
  tx: Prisma.TransactionClient,
  archiveId: string
) => Promise<{ transaction: Prisma.TransactionClient; completion: GeneratedArchiveCompletion } | null> = async () => null;
