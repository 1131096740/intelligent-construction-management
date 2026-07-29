#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-var-requires */

const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const MAX_SCAN = 500;
const REPORT_TTL_MS = 30 * 60 * 1000;
const ACTION = "contract.draft_retention.batch";
const FILE_CATEGORY = "unbound_temporary_file";
const BUSINESS_CATEGORY = "pristine_abandoned_contract_draft";
const TERMINAL_JOB_STATUSES = [
  "completed",
  "failed",
  "discarded",
  "invalidated"
];
const TECHNICAL_FILE_KINDS = new Set([
  "contract_bill_import_file_record",
  "settlement_import_file_record",
  "settlement_template_preview_file_record",
  "contract_layout_preview_file_record",
  "contract_generated_failed_file_record",
  "contract_generated_superseded_file_record"
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function databaseFingerprint(databaseUrl) {
  invariant(typeof databaseUrl === "string" && databaseUrl.length > 0, "DATABASE_URL is required");
  return crypto.createHash("sha256").update(databaseUrl).digest("hex");
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    includeBusinessPurge: false,
    timerApprovedTemporary: false,
    help: false
  };
  const mapping = {
    "--report": "reportPath",
    "--batch-id": "batchId",
    "--expected-database-fingerprint": "expectedDatabaseFingerprint",
    "--expected-report-sha256": "expectedReportSha256",
    "--confirm": "confirmation"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      parsed.apply = true;
      continue;
    }
    if (argument === "--include-business-purge") {
      parsed.includeBusinessPurge = true;
      continue;
    }
    if (argument === "--timer-approved-temporary") {
      parsed.timerApprovedTemporary = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    const [rawKey, inlineValue] = argument.split("=", 2);
    const key = mapping[rawKey];
    invariant(key, `不支持的参数：${argument}`);
    const value = inlineValue ?? argv[index + 1];
    invariant(value && !value.startsWith("--"), `参数 ${rawKey} 缺少值`);
    parsed[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  invariant(
    !(parsed.timerApprovedTemporary && parsed.apply),
    "--timer-approved-temporary 不能与 --apply 同时使用"
  );
  invariant(
    !(parsed.timerApprovedTemporary && parsed.includeBusinessPurge),
    "定时器模式永远不能包含业务草稿物理清理"
  );
  return parsed;
}

function createReport({
  databaseFingerprint: fingerprint,
  generatedAt,
  scanTruncated,
  candidates
}) {
  invariant(/^[0-9a-f]{64}$/u.test(fingerprint), "database fingerprint 无效");
  invariant(Array.isArray(candidates), "retention candidates 必须是数组");
  const safeCandidates = scanTruncated
    ? []
    : candidates
        .map((candidate) => ({
          id: String(candidate.id),
          category: String(candidate.category),
          kind: String(candidate.kind),
          bytes: String(candidate.bytes ?? "0")
        }))
        .sort((left, right) =>
          `${left.category}:${left.id}`.localeCompare(
            `${right.category}:${right.id}`
          )
        );
  invariant(
    safeCandidates.every((candidate) => /^\d+$/u.test(candidate.bytes)),
    "retention candidate bytes 无效"
  );
  const body = {
    schemaVersion: 1,
    mode: "preview",
    status: scanTruncated ? "blocked" : "ready",
    databaseFingerprint: fingerprint,
    generatedAt,
    expiresAt: new Date(
      new Date(generatedAt).getTime() + REPORT_TTL_MS
    ).toISOString(),
    scan: {
      maxRows: MAX_SCAN,
      truncated: Boolean(scanTruncated)
    },
    summary: {
      candidateCount: safeCandidates.length,
      candidateBytes: safeCandidates
        .reduce((sum, candidate) => sum + BigInt(candidate.bytes), 0n)
        .toString()
    },
    candidates: safeCandidates
  };
  return { ...body, reportSha256: sha256(body) };
}

function verifyReport(report) {
  invariant(report && typeof report === "object", "retention report 无效");
  const { reportSha256, ...body } = report;
  invariant(
    typeof reportSha256 === "string" &&
      reportSha256 === sha256(body),
    "retention report SHA-256 不匹配"
  );
}

function expectedConfirmation(batchId) {
  return `EXECUTE_CONTRACT_DRAFT_RETENTION_${batchId}`;
}

function assertApplyGates({
  args,
  report,
  currentDatabaseFingerprint,
  now
}) {
  invariant(args.apply === true, "只有显式 --apply 才能执行 retention");
  invariant(typeof args.reportPath === "string", "apply 必须提供 --report");
  invariant(
    typeof args.batchId === "string" &&
      /^[a-z0-9][a-z0-9._-]{2,79}$/iu.test(args.batchId),
    "apply 必须提供安全稳定的 --batch-id"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(args.expectedDatabaseFingerprint ?? ""),
    "apply 必须提供数据库 fingerprint"
  );
  invariant(
    /^[0-9a-f]{64}$/u.test(args.expectedReportSha256 ?? ""),
    "apply 必须提供报告 SHA-256"
  );
  invariant(
    args.confirmation === expectedConfirmation(args.batchId),
    `确认串必须精确为 ${expectedConfirmation(args.batchId)}`
  );
  verifyReport(report);
  invariant(
    report.status === "ready" && report.scan?.truncated === false,
    "retention report blocked or truncated"
  );
  invariant(
    report.reportSha256 === args.expectedReportSha256,
    "retention report SHA-256 与预期不同"
  );
  invariant(
    report.databaseFingerprint === args.expectedDatabaseFingerprint &&
      currentDatabaseFingerprint === args.expectedDatabaseFingerprint,
    "retention database fingerprint 与预期不同"
  );
  invariant(
    new Date(report.expiresAt).getTime() >= now.getTime(),
    "retention preview expired"
  );
}

function safeReceipt({
  status,
  report,
  deletedCount,
  deletedBytes,
  failedCount,
  skippedCount,
  businessPurgeSkippedCount,
  categoryResults
}) {
  return {
    status,
    reportSha256: report.reportSha256,
    deletedCount,
    deletedBytes: deletedBytes.toString(),
    failedCount,
    skippedCount,
    businessPurgeSkippedCount,
    categoryResults
  };
}

async function executeRetention({ store, storage, report, options }) {
  verifyReport(report);
  invariant(report.status === "ready", "retention report 不是 ready");
  const candidates = report.candidates;
  const rescanned = [];
  for (const candidate of candidates) {
    const current = await store.rescan(candidate);
    if (current.truncated) {
      return safeReceipt({
        status: "blocked",
        report,
        deletedCount: 0,
        deletedBytes: 0n,
        failedCount: 0,
        skippedCount: candidates.length,
        businessPurgeSkippedCount: 0,
        categoryResults: [{ category: candidate.category, result: "scan_truncated" }]
      });
    }
    rescanned.push({ candidate, current });
  }

  let deletedCount = 0;
  let deletedBytes = 0n;
  let failedCount = 0;
  let skippedCount = 0;
  let businessPurgeSkippedCount = 0;
  const byCategory = new Map();
  const bump = (category, result) => {
    const key = `${category}:${result}`;
    byCategory.set(key, (byCategory.get(key) ?? 0) + 1);
  };

  for (const { candidate, current } of rescanned) {
    if (!current.safe) {
      skippedCount += 1;
      bump(candidate.category, "rescan_not_safe");
      continue;
    }
    if (candidate.kind === "business_draft") {
      if (!options.businessPurgeEnabled) {
        businessPurgeSkippedCount += 1;
        bump(candidate.category, "business_purge_disabled");
        continue;
      }
      const writes = await store.purgeBusinessDraft(candidate);
      if (writes > 0) {
        deletedCount += 1;
        bump(candidate.category, "deleted");
      } else {
        skippedCount += 1;
        bump(candidate.category, "already_absent");
      }
      continue;
    }
    if (!options.tempEnabled) {
      skippedCount += 1;
      bump(candidate.category, "temporary_retention_disabled");
      continue;
    }
    if (TECHNICAL_FILE_KINDS.has(candidate.kind)) {
      const result = await store.deleteTechnicalFileRecord(candidate, storage);
      deletedBytes += BigInt(result.deletedBytes);
      if (result.result === "deleted") {
        deletedCount += 1;
      } else if (result.result === "failed_retryable") {
        failedCount += 1;
      } else {
        skippedCount += 1;
      }
      bump(candidate.category, result.result);
      continue;
    }
    if (candidate.kind === "file") {
      try {
        await store.markFileDeleting(candidate.id);
        await storage.delete(current.objectKey);
      } catch {
        failedCount += 1;
        bump(candidate.category, "failed_retryable");
        await store.restoreFileActive(candidate.id).catch(() => undefined);
        continue;
      }
      try {
        await store.deleteFileRecord(candidate.id);
        deletedCount += 1;
        deletedBytes += BigInt(candidate.bytes);
        bump(candidate.category, "deleted");
      } catch {
        failedCount += 1;
        bump(candidate.category, "failed_retryable");
      }
      continue;
    }
    const writes = await store.deleteTechnicalRecord(candidate);
    if (writes > 0) {
      deletedCount += 1;
      bump(candidate.category, "deleted");
    } else {
      skippedCount += 1;
      bump(candidate.category, "already_absent");
    }
  }
  const receipt = safeReceipt({
    status: failedCount > 0 ? "partial" : "applied",
    report,
    deletedCount,
    deletedBytes,
    failedCount,
    skippedCount,
    businessPurgeSkippedCount,
    categoryResults: [...byCategory.entries()]
      .map(([key, count]) => {
        const [category, result] = key.split(":");
        return { category, result, count };
      })
      .sort((left, right) =>
        `${left.category}:${left.result}`.localeCompare(
          `${right.category}:${right.result}`
        )
      )
  });
  await store.recordBatch(receipt);
  return receipt;
}

function readDatabaseUrl(filePath) {
  try {
    const line = readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (!line) return undefined;
    const raw = line.slice(line.indexOf("=") + 1).trim();
    return (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw
    );
  } catch {
    return undefined;
  }
}

async function businessBindingIds(tx, ids, excludedBindings = []) {
  if (!ids.length) return new Set();
  const {
    acquireFileBusinessBindingTransactionLock,
    nonReceiptBusinessFileBindingIds
  } = require("../dist/file/file-business-binding");
  await acquireFileBusinessBindingTransactionLock(tx);
  const [nonReceipt, receiptPhotos, replacements] = await Promise.all([
    nonReceiptBusinessFileBindingIds(tx, ids, excludedBindings),
    tx.spotProcurementReceiptPhoto.findMany({
      where: {
        OR: [
          { originalFileId: { in: ids } },
          { watermarkedFileId: { in: ids } }
        ]
      },
      select: { originalFileId: true, watermarkedFileId: true }
    }),
    tx.fileObject.findMany({
      where: { supersedesFileObjectId: { in: ids } },
      select: { id: true, supersedesFileObjectId: true }
    })
  ]);
  return new Set([
    ...nonReceipt,
    ...receiptPhotos.flatMap((row) => [
      row.originalFileId,
      row.watermarkedFileId
    ]),
    ...replacements.flatMap((row) => [row.id, row.supersedesFileObjectId])
  ]);
}

async function candidatesWithFileBytes(prisma, candidates) {
  const fileIds = [
    ...new Set(
      candidates.flatMap((candidate) => candidate.fileIds ?? []).filter(Boolean)
    )
  ];
  const files = fileIds.length
    ? await prisma.fileObject.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, sizeBytes: true }
      })
    : [];
  const sizes = new Map(files.map((file) => [file.id, BigInt(file.sizeBytes)]));
  return candidates.map(({ fileIds: candidateFileIds, ...candidate }) => ({
    ...candidate,
    bytes: (candidateFileIds ?? [])
      .reduce((sum, fileId) => sum + (sizes.get(fileId) ?? 0n), 0n)
      .toString()
  }));
}

async function inspectWithClient(prisma, now = new Date()) {
  const fileRows = await prisma.fileObject.findMany({
    where: {
      storageStatus: { in: ["active", "deleting"] },
      createdAt: { lt: new Date(now.getTime() - 86_400_000) }
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_SCAN + 1,
    select: {
      id: true,
      sizeBytes: true,
      supersedesFileObjectId: true
    }
  });
  const scanTruncated = fileRows.length > MAX_SCAN;
  if (scanTruncated) {
    return createReport({
      databaseFingerprint: databaseFingerprint(process.env.DATABASE_URL),
      generatedAt: now.toISOString(),
      scanTruncated: true,
      candidates: []
    });
  }
  const chainBound = new Set(
    fileRows.flatMap((row) =>
      row.supersedesFileObjectId
        ? [row.id, row.supersedesFileObjectId]
        : []
    )
  );
  const pendingFiles = fileRows.filter((row) => !chainBound.has(row.id));
  const boundIds = await prisma.$transaction(
    (tx) => businessBindingIds(tx, pendingFiles.map((row) => row.id)),
    { isolationLevel: "RepeatableRead" }
  );
  const [
    saveRequests,
    billImports,
    settlementImports,
    settlementPreviewJobs,
    layoutPreviewJobs,
    failedGeneratedDocuments,
    supersededGeneratedDocuments,
    abandonedDrafts
  ] =
    await Promise.all([
      prisma.contractDraftSaveRequest.findMany({
        where: {
          createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) }
        },
        orderBy: [{ createdAt: "asc" }, { idempotencyKey: "asc" }],
        take: MAX_SCAN + 1,
        select: { idempotencyKey: true }
      }),
      prisma.contractBillImport.findMany({
        where: {
          status: { in: ["preview", "failed"] },
          createdAt: { lt: new Date(now.getTime() - 7 * 86_400_000) }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_SCAN + 1,
        select: { id: true, fileId: true }
      }),
      prisma.settlementImport.findMany({
        where: {
          status: { in: ["preview", "failed"] },
          updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) }
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_SCAN + 1,
        select: { id: true, fileId: true }
      }),
      prisma.settlementTemplatePreviewJob.findMany({
        where: {
          status: { in: TERMINAL_JOB_STATUSES },
          updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) }
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_SCAN + 1,
        select: {
          id: true,
          previewXlsxFileId: true,
          previewPdfFileId: true
        }
      }),
      prisma.contractLayoutPreviewJob.findMany({
        where: { status: { in: TERMINAL_JOB_STATUSES } },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_SCAN + 1,
        select: { id: true, previewPdfFileId: true }
      }),
      prisma.contractGeneratedDocument.findMany({
        where: { purpose: "draft", status: "failed" },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_SCAN + 1,
        select: { id: true, docxFileId: true, pdfFileId: true }
      }),
      prisma.$queryRawUnsafe(
        `SELECT ranked."id", ranked."docxFileId", ranked."pdfFileId"
         FROM (
           SELECT d."id", d."docxFileId", d."pdfFileId",
             row_number() OVER (
               PARTITION BY d."contractVersionId"
               ORDER BY d."sourceRevision" DESC, d."updatedAt" DESC, d."id" DESC
             ) AS "retentionRank"
           FROM "ContractGeneratedDocument" d
           WHERE d."purpose" = 'draft'
             AND d."status" IN ('success', 'stale')
         ) ranked
         WHERE ranked."retentionRank" > 1
         ORDER BY ranked."id"
         LIMIT $1`,
        MAX_SCAN + 1
      ),
      prisma.contractVersion.findMany({
        where: {
          status: "abandoned",
          abandonedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) },
          abandonReason: null,
          changeType: "original",
          versionNo: 1
        },
        orderBy: [{ abandonedAt: "asc" }, { id: "asc" }],
        take: MAX_SCAN + 1,
        select: { id: true }
      })
    ]);
  const otherTruncated = [
    saveRequests,
    billImports,
    settlementImports,
    settlementPreviewJobs,
    layoutPreviewJobs,
    failedGeneratedDocuments,
    supersededGeneratedDocuments,
    abandonedDrafts
  ].some((rows) => rows.length > MAX_SCAN);
  const technicalFileCandidates = await candidatesWithFileBytes(prisma, [
    ...billImports.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: "contract_bill_import_preview",
      kind: "contract_bill_import_file_record",
      fileIds: [row.fileId]
    })),
    ...settlementImports.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: "settlement_contract_import_preview",
      kind: "settlement_import_file_record",
      fileIds: [row.fileId]
    })),
    ...settlementPreviewJobs.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: "settlement_contract_import_preview",
      kind: "settlement_template_preview_file_record",
      fileIds: [row.previewXlsxFileId, row.previewPdfFileId]
    })),
    ...layoutPreviewJobs.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: "render_intermediate_file",
      kind: "contract_layout_preview_file_record",
      fileIds: [row.previewPdfFileId]
    })),
    ...failedGeneratedDocuments.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: "render_intermediate_file",
      kind: "contract_generated_failed_file_record",
      fileIds: [row.docxFileId, row.pdfFileId]
    })),
    ...supersededGeneratedDocuments.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: "contract_draft_preview_superseded",
      kind: "contract_generated_superseded_file_record",
      fileIds: [row.docxFileId, row.pdfFileId]
    }))
  ]);
  const candidates = [
    ...pendingFiles
      .filter((row) => !boundIds.has(row.id))
      .map((row) => ({
        id: row.id,
        category: FILE_CATEGORY,
        kind: "file",
        bytes: String(row.sizeBytes)
      })),
    ...saveRequests.slice(0, MAX_SCAN).map((row) => ({
      id: row.idempotencyKey,
      category: "contract_draft_save_receipt",
      kind: "technical_record",
      bytes: "0"
    })),
    ...technicalFileCandidates,
    ...abandonedDrafts.slice(0, MAX_SCAN).map((row) => ({
      id: row.id,
      category: BUSINESS_CATEGORY,
      kind: "business_draft",
      bytes: "0"
    }))
  ];
  return createReport({
    databaseFingerprint: databaseFingerprint(process.env.DATABASE_URL),
    generatedAt: now.toISOString(),
    scanTruncated: otherTruncated,
    candidates
  });
}

async function technicalFileRecordState(prisma, candidate, now = new Date()) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  let fileIds = [];
  let exclusions = [];
  if (candidate.kind === "contract_bill_import_file_record") {
    const row = await prisma.contractBillImport.findUnique({
      where: { id: candidate.id },
      select: { fileId: true, status: true, createdAt: true }
    });
    if (
      !row ||
      !["preview", "failed"].includes(row.status) ||
      row.createdAt.getTime() >= sevenDaysAgo.getTime()
    ) {
      return { safe: false, truncated: false };
    }
    fileIds = [row.fileId];
    exclusions = [{ table: "ContractBillImport", column: "fileId" }];
  } else if (candidate.kind === "settlement_import_file_record") {
    const row = await prisma.settlementImport.findUnique({
      where: { id: candidate.id },
      select: { fileId: true, status: true, updatedAt: true }
    });
    if (
      !row ||
      !["preview", "failed"].includes(row.status) ||
      row.updatedAt.getTime() >= sevenDaysAgo.getTime()
    ) {
      return { safe: false, truncated: false };
    }
    fileIds = [row.fileId];
    exclusions = [{ table: "SettlementImport", column: "fileId" }];
  } else if (candidate.kind === "settlement_template_preview_file_record") {
    const row = await prisma.settlementTemplatePreviewJob.findUnique({
      where: { id: candidate.id },
      select: {
        previewXlsxFileId: true,
        previewPdfFileId: true,
        status: true,
        updatedAt: true
      }
    });
    if (
      !row ||
      !TERMINAL_JOB_STATUSES.includes(row.status) ||
      row.updatedAt.getTime() >= sevenDaysAgo.getTime()
    ) {
      return { safe: false, truncated: false };
    }
    fileIds = [row.previewXlsxFileId, row.previewPdfFileId];
    exclusions = [
      { table: "SettlementTemplatePreviewJob", column: "previewXlsxFileId" },
      { table: "SettlementTemplatePreviewJob", column: "previewPdfFileId" }
    ];
  } else if (candidate.kind === "contract_layout_preview_file_record") {
    const row = await prisma.contractLayoutPreviewJob.findUnique({
      where: { id: candidate.id },
      select: { previewPdfFileId: true, status: true }
    });
    if (!row || !TERMINAL_JOB_STATUSES.includes(row.status)) {
      return { safe: false, truncated: false };
    }
    fileIds = [row.previewPdfFileId];
    exclusions = [
      { table: "ContractLayoutPreviewJob", column: "previewPdfFileId" }
    ];
  } else if (
    candidate.kind === "contract_generated_failed_file_record" ||
    candidate.kind === "contract_generated_superseded_file_record"
  ) {
    const row = await prisma.contractGeneratedDocument.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        contractVersionId: true,
        purpose: true,
        status: true,
        docxFileId: true,
        pdfFileId: true
      }
    });
    if (!row || row.purpose !== "draft") {
      return { safe: false, truncated: false };
    }
    if (
      candidate.kind === "contract_generated_failed_file_record" &&
      row.status !== "failed"
    ) {
      return { safe: false, truncated: false };
    }
    if (candidate.kind === "contract_generated_superseded_file_record") {
      if (!["success", "stale"].includes(row.status)) {
        return { safe: false, truncated: false };
      }
      const latest = await prisma.contractGeneratedDocument.findFirst({
        where: {
          contractVersionId: row.contractVersionId,
          purpose: "draft",
          status: { in: ["success", "stale"] }
        },
        orderBy: [
          { sourceRevision: "desc" },
          { updatedAt: "desc" },
          { id: "desc" }
        ],
        select: { id: true }
      });
      if (!latest || latest.id === row.id) {
        return { safe: false, truncated: false };
      }
      const [offlineReference, negotiationReference, draftReference] =
        await Promise.all([
          prisma.contractOfflineRevision.findFirst({
            where: { sourceGeneratedDocumentId: row.id },
            select: { id: true }
          }),
          prisma.contractNegotiationRound.findFirst({
            where: { sourceGeneratedDocumentId: row.id },
            select: { id: true }
          }),
          prisma.$queryRawUnsafe(
            `SELECT "id"
             FROM "ContractVersion"
             WHERE COALESCE(
               "draftData" #> '{workbenchReferences,referencedGeneratedDocumentIds}',
               '[]'::jsonb
             ) @> to_jsonb(ARRAY[$1]::text[])
             LIMIT 1`,
            row.id
          )
        ]);
      if (offlineReference || negotiationReference || draftReference.length) {
        return { safe: false, truncated: false };
      }
    }
    fileIds = [row.docxFileId, row.pdfFileId];
    exclusions = [
      { table: "ContractGeneratedDocument", column: "docxFileId" },
      { table: "ContractGeneratedDocument", column: "pdfFileId" }
    ];
  } else {
    return { safe: false, truncated: false };
  }
  const uniqueFileIds = [...new Set(fileIds.filter(Boolean))];
  const files = uniqueFileIds.length
    ? await prisma.fileObject.findMany({
        where: {
          id: { in: uniqueFileIds },
          storageStatus: { in: ["active", "deleting"] }
        },
        select: {
          id: true,
          objectKey: true,
          sizeBytes: true,
          storageStatus: true
        }
      })
    : [];
  const bound = await businessBindingIds(prisma, uniqueFileIds, exclusions);
  return {
    safe: uniqueFileIds.every((id) => !bound.has(id)),
    truncated: false,
    files,
    exclusions
  };
}

function createSqlStore(prisma, context) {
  async function rescan(candidate) {
    if (candidate.kind === "file") {
      const result = await prisma.$transaction(
        async (tx) => {
          const file = await tx.fileObject.findUnique({
            where: { id: candidate.id },
            select: {
              id: true,
              objectKey: true,
              storageStatus: true,
              supersedesFileObjectId: true
            }
          });
          if (
            !file ||
            !["active", "deleting"].includes(file.storageStatus)
          ) {
            return { safe: false, truncated: false };
          }
          if (file.supersedesFileObjectId) {
            return { safe: false, truncated: false };
          }
          const bound = await businessBindingIds(tx, [file.id]);
          return {
            safe: !bound.has(file.id),
            truncated: false,
            ...(bound.has(file.id) ? {} : { objectKey: file.objectKey })
          };
        },
        { isolationLevel: "Serializable" }
      );
      return result;
    }
    if (TECHNICAL_FILE_KINDS.has(candidate.kind)) {
      return prisma.$transaction(
        (tx) => technicalFileRecordState(tx, candidate),
        { isolationLevel: "Serializable" }
      );
    }
    if (candidate.kind === "business_draft") {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT v."id"
         FROM "ContractVersion" v
         JOIN "Contract" c ON c."id" = v."contractId"
         WHERE v."id" = $1
           AND v."status" = 'abandoned'
           AND v."abandonedAt" < now() - interval '7 days'
           AND v."abandonReason" IS NULL
           AND v."changeType" = 'original'
           AND v."versionNo" = 1
           AND v."baseVersionId" IS NULL
           AND v."supersedesVersionId" IS NULL
           AND v."copiedFromContractVersionId" IS NULL
           AND c."code" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "ApprovalInstance" a WHERE a."businessType" = 'contract_version' AND a."businessId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractDraftSubmissionRequest" r WHERE r."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractSealTask" s WHERE s."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractArchiveFile" a WHERE a."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractFormalFile" f WHERE f."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractAuthorization" a WHERE a."originContractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractVersionAuthorizationLink" l WHERE l."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "Settlement" s WHERE s."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "SettlementDraft" s WHERE s."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "SettlementImport" i WHERE i."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractSettlementProcess" p WHERE p."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "PaymentRequest" p WHERE p."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractTakeover" t WHERE t."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractDraftCheckpoint" cp WHERE cp."contractVersionId" = v."id")
           AND v."taxFactEvidenceFileId" IS NULL
           AND NOT EXISTS (SELECT 1 FROM "ContractTaxFactRevision" r WHERE r."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractDraftAttachment" a WHERE a."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractGeneratedDocument" d WHERE d."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractOfflineRevision" r WHERE r."contractVersionId" = v."id")
           AND NOT EXISTS (SELECT 1 FROM "ContractNegotiationRound" n WHERE n."contractVersionId" = v."id")
           AND NOT EXISTS (
             SELECT 1
             FROM "ContractBill" b
             WHERE b."contractVersionId" = v."id"
               AND b."sourceExcelFileId" IS NOT NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM "ContractBillImport" i
             JOIN "ContractBill" b ON b."id" = i."contractBillId"
             WHERE b."contractVersionId" = v."id"
           )
           AND NOT EXISTS (
             SELECT 1 FROM "ContractBillRowTransition" t
             WHERE t."fromContractVersionId" = v."id"
                OR t."toContractVersionId" = v."id"
           )
           AND NOT EXISTS (SELECT 1 FROM "ContractVersion" d WHERE d."baseVersionId" = v."id" OR d."supersedesVersionId" = v."id" OR d."copiedFromContractVersionId" = v."id")
         FOR UPDATE OF v, c`,
        candidate.id
      );
      return { safe: rows.length === 1, truncated: false };
    }
    return { safe: true, truncated: false };
  }

  async function markFileDeleting(id) {
    return prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findUnique({
        where: { id },
        select: { id: true, storageStatus: true }
      });
      invariant(
        file && ["active", "deleting"].includes(file.storageStatus),
        "FileObject 已变化，拒绝删除对象"
      );
      const bound = await businessBindingIds(tx, [id]);
      invariant(!bound.has(id), "FileObject 已被业务绑定，拒绝删除对象");
      const changed = await tx.fileObject.updateMany({
        where: { id, storageStatus: { in: ["active", "deleting"] } },
        data: { storageStatus: "deleting" }
      });
      invariant(changed.count === 1, "FileObject 已变化，拒绝删除对象");
    }, {
      isolationLevel: "Serializable"
    });
  }

  async function deleteFileRecord(id) {
    const deleted = await prisma.fileObject.deleteMany({
      where: { id, storageStatus: "deleting" }
    });
    invariant(deleted.count === 1, "对象删除后 FileObject 状态异常");
  }

  async function restoreFileActive(id) {
    await prisma.fileObject.updateMany({
      where: { id, storageStatus: "deleting" },
      data: { storageStatus: "active" }
    });
  }

  async function deleteTechnicalRecord(candidate) {
    if (
      candidate.kind === "technical_record" &&
      candidate.category === "contract_draft_save_receipt"
    ) {
      const deleted = await prisma.contractDraftSaveRequest.deleteMany({
        where: { idempotencyKey: candidate.id }
      });
      return deleted.count;
    }
    if (candidate.kind === "contract_bill_import_file_record") {
      const deleted = await prisma.contractBillImport.deleteMany({
        where: { id: candidate.id, status: { in: ["preview", "failed"] } }
      });
      return deleted.count;
    }
    if (candidate.kind === "settlement_import_file_record") {
      const deleted = await prisma.settlementImport.deleteMany({
        where: { id: candidate.id, status: { in: ["preview", "failed"] } }
      });
      return deleted.count;
    }
    if (candidate.kind === "settlement_template_preview_file_record") {
      const deleted = await prisma.settlementTemplatePreviewJob.deleteMany({
        where: { id: candidate.id, status: { in: TERMINAL_JOB_STATUSES } }
      });
      return deleted.count;
    }
    if (candidate.kind === "contract_layout_preview_file_record") {
      const deleted = await prisma.contractLayoutPreviewJob.deleteMany({
        where: { id: candidate.id, status: { in: TERMINAL_JOB_STATUSES } }
      });
      return deleted.count;
    }
    if (
      candidate.kind === "contract_generated_failed_file_record" ||
      candidate.kind === "contract_generated_superseded_file_record"
    ) {
      const deleted = await prisma.contractGeneratedDocument.deleteMany({
        where: {
          id: candidate.id,
          purpose: "draft",
          status:
            candidate.kind === "contract_generated_failed_file_record"
              ? "failed"
              : { in: ["success", "stale"] }
        }
      });
      return deleted.count;
    }
    return 0;
  }

  async function deleteTechnicalFileRecord(candidate, storage) {
    const reserved = await prisma.$transaction(async (tx) => {
      const state = await technicalFileRecordState(tx, candidate);
      if (!state.safe) return state;
      for (const file of state.files) {
        const changed = await tx.fileObject.updateMany({
          where: {
            id: file.id,
            storageStatus: { in: ["active", "deleting"] }
          },
          data: { storageStatus: "deleting" }
        });
        invariant(changed.count === 1, "技术文件已变化，拒绝删除对象");
      }
      return state;
    }, {
      isolationLevel: "Serializable"
    });
    if (!reserved.safe) {
      return { result: "rescan_not_safe", writes: 0, deletedBytes: 0n };
    }
    let deletedBytes = 0n;
    for (const file of reserved.files) {
      try {
        await storage.delete(file.objectKey);
      } catch {
        await prisma.fileObject.updateMany({
          where: {
            id: { in: reserved.files.map((item) => item.id) },
            storageStatus: "deleting"
          },
          data: { storageStatus: "active" }
        }).catch(() => undefined);
        return { result: "failed_retryable", writes: 0, deletedBytes };
      }
      try {
        await deleteFileRecord(file.id);
        deletedBytes += BigInt(file.sizeBytes);
      } catch {
        return { result: "failed_retryable", writes: 0, deletedBytes };
      }
    }
    const writes = await deleteTechnicalRecord(candidate);
    return {
      result: writes > 0 ? "deleted" : "already_absent",
      writes,
      deletedBytes
    };
  }

  async function purgeBusinessDraft(candidate) {
    return prisma.$transaction(
      async (tx) => {
        const current = await createSqlStore(tx, context).rescan(candidate);
        invariant(current.safe, "业务草稿锁后不再纯净");
        const versions = await tx.contractVersion.findMany({
          where: { id: candidate.id },
          select: { id: true, contractId: true }
        });
        if (!versions.length) return 0;
        const contractId = versions[0].contractId;
        await tx.contractDraftEditLease.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        await tx.contractDraftSaveRequest.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        await tx.contractBillRowCarryForward.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        await tx.contractBillRow.deleteMany({
          where: {
            contractBillId: {
              in: (
                await tx.contractBill.findMany({
                  where: { contractVersionId: candidate.id },
                  select: { id: true }
                })
              ).map((row) => row.id)
            }
          }
        });
        await tx.contractBillImport.deleteMany({
          where: {
            contractBillId: {
              in: (
                await tx.contractBill.findMany({
                  where: { contractVersionId: candidate.id },
                  select: { id: true }
                })
              ).map((row) => row.id)
            }
          }
        });
        await tx.contractBill.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        await tx.contractBillRowLineage.deleteMany({
          where: { createdInContractVersionId: candidate.id }
        });
        const termIds = (
          await tx.paymentTermsVersion.findMany({
            where: { contractVersionId: candidate.id },
            select: { id: true }
          })
        ).map((row) => row.id);
        await tx.paymentTermsStage.deleteMany({
          where: { paymentTermsVersionId: { in: termIds } }
        });
        await tx.paymentTermsVersion.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        await tx.contractPartySnapshot.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        await tx.contractVersionAuthorizationLink.deleteMany({
          where: { contractVersionId: candidate.id }
        });
        const deleted = await tx.contractVersion.deleteMany({
          where: { id: candidate.id, status: "abandoned" }
        });
        if (deleted.count === 1) {
          const siblings = await tx.contractVersion.count({
            where: { contractId }
          });
          if (siblings === 0) {
            await tx.contract.deleteMany({ where: { id: contractId } });
          }
        }
        return deleted.count;
      },
      { isolationLevel: "Serializable" }
    );
  }

  async function recordBatch(receipt) {
    const existing = await prisma.auditLog.findFirst({
      where: {
        action: ACTION,
        metadata: { path: ["batchId"], equals: context.batchId }
      },
      select: { id: true, metadata: true }
    });
    if (existing) {
      const metadata =
        existing.metadata &&
        typeof existing.metadata === "object" &&
        !Array.isArray(existing.metadata)
          ? existing.metadata
          : {};
      invariant(
        metadata.reportSha256 === context.reportSha256,
        "retention batch id 已绑定其他 report SHA-256"
      );
      return;
    }
    await prisma.auditLog.create({
      data: {
        actorUserId: null,
        action: ACTION,
        businessType: "retention_batch",
        businessId: context.batchId,
        metadata: {
          batchId: context.batchId,
          reportSha256: context.reportSha256,
          deletedCount: receipt.deletedCount,
          deletedBytes: receipt.deletedBytes,
          failedCount: receipt.failedCount,
          skippedCount: receipt.skippedCount,
          businessPurgeSkippedCount: receipt.businessPurgeSkippedCount,
          categoryResults: receipt.categoryResults
        }
      }
    });
  }
  return {
    rescan,
    markFileDeleting,
    deleteFileRecord,
    restoreFileActive,
    deleteTechnicalRecord,
    deleteTechnicalFileRecord,
    purgeBusinessDraft,
    recordBatch
  };
}

async function createStorage() {
  const { PrivateFileStorage } = require("../dist/file/file.service");
  const storage = new PrivateFileStorage();
  storage.onModuleInit();
  return storage;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    const databaseUrl = readDatabaseUrl(path.resolve(__dirname, "../.env"));
    if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  }
  invariant(process.env.DATABASE_URL, "DATABASE_URL is required");
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "preview: node execute-contract-draft-retention.cjs\napply: --apply --report <file> --batch-id <id> --expected-database-fingerprint <sha> --expected-report-sha256 <sha> --confirm EXECUTE_CONTRACT_DRAFT_RETENTION_<id>\ntimer: --timer-approved-temporary（仅在临时清理开关已显式启用时生效，永不清理业务草稿）\n"
    );
    return;
  }
  const prisma = new PrismaClient();
  try {
    if (args.timerApprovedTemporary) {
      invariant(
        process.env.CONTRACT_DRAFT_TEMP_RETENTION_ENABLED === "true",
        "定时器临时清理开关未启用"
      );
      invariant(
        process.env.CONTRACT_DRAFT_BUSINESS_PURGE_ENABLED !== "true",
        "定时器拒绝在业务草稿物理清理开关开启时运行"
      );
      const now = new Date();
      const report = await inspectWithClient(prisma, now);
      const batchId = `timer-${now.toISOString().replace(/[^0-9]/gu, "").slice(0, 14)}`;
      const currentDatabaseFingerprint = databaseFingerprint(
        process.env.DATABASE_URL
      );
      assertApplyGates({
        args: {
          apply: true,
          reportPath: "timer://in-process",
          batchId,
          expectedDatabaseFingerprint: currentDatabaseFingerprint,
          expectedReportSha256: report.reportSha256,
          confirmation: expectedConfirmation(batchId)
        },
        report,
        currentDatabaseFingerprint,
        now
      });
      const receipt = await executeRetention({
        store: createSqlStore(prisma, {
          batchId,
          reportSha256: report.reportSha256
        }),
        storage: await createStorage(),
        report,
        options: {
          tempEnabled: true,
          businessPurgeEnabled: false,
          now
        }
      });
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return;
    }
    if (!args.apply) {
      const preview = await inspectWithClient(prisma);
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
      return;
    }
    const report = JSON.parse(
      readFileSync(path.resolve(args.reportPath ?? ""), "utf8")
    );
    const currentDatabaseFingerprint = databaseFingerprint(
      process.env.DATABASE_URL
    );
    assertApplyGates({
      args,
      report,
      currentDatabaseFingerprint,
      now: new Date()
    });
    const tempEnabled =
      process.env.CONTRACT_DRAFT_TEMP_RETENTION_ENABLED === "true";
    const businessPurgeEnabled =
      args.includeBusinessPurge === true &&
      process.env.CONTRACT_DRAFT_BUSINESS_PURGE_ENABLED === "true";
    const receipt = await executeRetention({
      store: createSqlStore(prisma, {
        batchId: args.batchId,
        reportSha256: report.reportSha256
      }),
      storage: await createStorage(),
      report,
      options: {
        tempEnabled,
        businessPurgeEnabled,
        now: new Date()
      }
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  MAX_SCAN,
  REPORT_TTL_MS,
  ACTION,
  parseArgs,
  canonicalize,
  sha256,
  databaseFingerprint,
  createReport,
  verifyReport,
  expectedConfirmation,
  assertApplyGates,
  executeRetention,
  inspectWithClient,
  createSqlStore
};

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(
      "合同草稿保留策略执行失败；未输出对象路径，请检查只读报告、授权开关和审计日志。\n"
    );
    process.exitCode = 1;
  });
}
