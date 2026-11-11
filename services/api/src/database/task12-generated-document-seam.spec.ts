import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { ContractDocumentWorkerModule } from "../contract-document/contract-document-worker.module";
import { ContractTemplateModule } from "../contract-template/contract-template.module";
import { Task12FirstQ2ApplicationModule } from "./task12-first-q2-application.module";
import { Task12GeneratedDocumentApplicationModule } from "./task12-generated-document-application.module";
import { bindTask12PublishedMaterialTemplate, verifyTask12MaterialTemplate, runTask12GeneratedDocument, type GeneratedDocumentRequest } from "./task12-generated-document-seam";

const versionId = "a0000000-0000-4000-a000-000000000001";
const layoutId = "a0000000-0000-4000-a000-000000000002";
const generationId = "a0000000-0000-4000-a000-000000000003";
const docxFileId = "a0000000-0000-4000-a000-000000000004";
const pdfFileId = "a0000000-0000-4000-a000-000000000005";
const templateFileId = "a0000000-0000-4000-a000-000000000006";
const layoutPreviewId = "a0000000-0000-4000-a000-000000000007";
const layoutPreviewJobId = "a0000000-0000-4000-a000-000000000008";
const fp = "b".repeat(64);
const token = "z".repeat(43);
const templateFile = resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx");

it("admits the original template and worker only through the separate document app", () => {
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, Task12GeneratedDocumentApplicationModule);
  expect(imports.filter((entry: unknown) => entry === ContractTemplateModule)).toHaveLength(1);
  expect(imports.filter((entry: unknown) => entry === ContractDocumentWorkerModule)).toHaveLength(1);
  expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, Task12FirstQ2ApplicationModule)).not.toContain(ContractDocumentWorkerModule);
  expect(verifyTask12MaterialTemplate(readFileSync(templateFile))).toMatchObject({
    sha256: "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd"
  });
  expect(() => verifyTask12MaterialTemplate(readFileSync(templateFile).subarray(0, 20))).toThrow("TASK12_GENERATED_DOCUMENT_TEMPLATE");
});

function publishedFixture(source: ReturnType<typeof verifyTask12MaterialTemplate>) {
  const file = { id: templateFileId, sizeBytes: source.bytes, contentSha256: source.sha256 };
  const sourceMapping = { protocolVersion: 1, sourceFileId: templateFileId, draftRevision: 2,
    sourceSha256: source.sha256, fingerprint: "a".repeat(64), bindings: [],
    confirmation: { sourceFileId: templateFileId, sourceSha256: source.sha256, draftRevision: 2,
      mappingFingerprint: "a".repeat(64), previewJobId: layoutPreviewJobId, previewPdfFileId: layoutPreviewId }
  };
  const version = { id: layoutId, status: "published", docxFileId: templateFileId, draftRevision: 2,
    previewPdfFileId: layoutPreviewId, placeholderSchema: { sourceMapping } };
  return { file, version };
}

it("binds the verified upload bytes and the confirmed published template to the same layout", () => {
  const source = verifyTask12MaterialTemplate(readFileSync(templateFile));
  const { file, version } = publishedFixture(source);
  expect(bindTask12PublishedMaterialTemplate(source, file, version)).toMatchObject({ layoutId, sourceSha256: source.sha256 });
  expect(() => bindTask12PublishedMaterialTemplate(source, file, { ...version, previewPdfFileId: pdfFileId }))
    .toThrow("TASK12_GENERATED_DOCUMENT_TEMPLATE");
  expect(() => bindTask12PublishedMaterialTemplate(source, { ...file, contentSha256: fp }, version))
    .toThrow("TASK12_GENERATED_DOCUMENT_TEMPLATE");
});

function fixture(mode?: "heartbeat-conflict" | "old-output" | "equal-files" | "detached-output") {
  const trace: GeneratedDocumentRequest[] = [];
  const start = Date.parse("2026-11-11T01:00:00.000Z");
  let clock = start, expiry = start + 120_000;
  const source = verifyTask12MaterialTemplate(readFileSync(templateFile));
  const { file, version } = publishedFixture(source);
  const input = {
    template: bindTask12PublishedMaterialTemplate(source, file, version),
    versionId, sourceRevision: 4, documentContentRevision: 3,
    documentContentFingerprint: fp, lease: { token, leaseRevision: 1, expiresAt: new Date(expiry).toISOString() }
  };
  const port = {
    now: () => clock,
    async wait(ms: number) { clock += ms; },
    async send(request: GeneratedDocumentRequest) {
      trace.push(request);
      if (request.path.endsWith("/preview-generation")) return { status: 201, body: {
        generationId, status: "queued", sourceRevision: 4, documentContentRevision: 3, documentContentFingerprint: fp
      }};
      if (request.path.endsWith("/heartbeat")) {
        if (mode === "heartbeat-conflict") return { status: 409, body: { token: "private failure" } };
        expiry = clock + 120_000;
        return { status: 201, body: { leaseRevision: 1, expiresAt: new Date(expiry).toISOString() } };
      }
      const done = clock >= start + 31_000;
      return { status: 200, body: {
        version: { id: versionId, status: "draft", draftRevision: 4, layoutTemplateVersionId: layoutId,
          documentContentRevision: 3, documentContentFingerprint: fp,
          latestDraftPreviewDocumentId: done && mode !== "detached-output" ? generationId : null },
        lease: { state: "held_by_me", expiresAt: new Date(expiry).toISOString() },
        documents: [{ id: generationId, purpose: "draft", status: done ? "success" : "processing", sourceRevision: 4,
          documentContentRevision: 3, documentContentFingerprint: done && mode === "old-output" ? "c".repeat(64) : fp,
          docxFileId: done ? docxFileId : null, pdfFileId: done ? (mode === "equal-files" ? docxFileId : pdfFileId) : null }]
      }};
    }
  };
  return { input, port, trace };
}

it("uses the existing lease heartbeat while the original draft preview is processing", async () => {
  const f = fixture();
  await expect(runTask12GeneratedDocument(f.input, f.port)).resolves.toEqual({
    status: "DRAFT_WORD_PDF_COORDINATES_MATCHED", generationId, versionId, docxFileId, pdfFileId,
    sourceRevision: 4, documentContentRevision: 3, documentContentFingerprint: fp
  });
  expect(f.trace[0]).toEqual({ method: "POST", path: "/contract-drafts/" + versionId + "/preview-generation", json: { sourceRevision: 4 } });
  expect(f.trace.filter(request => request.path.endsWith("/heartbeat"))).toEqual([{
    method: "POST", path: "/contract-drafts/" + versionId + "/edit-lease/heartbeat",
    headers: { "x-contract-draft-lease": token }
  }]);
  expect(f.trace.at(-1)).toEqual({ method: "GET", path: "/contract-drafts/" + versionId + "/workbench",
    headers: { "x-contract-numeric-protocol": "2" } });
});

it.each([
  ["heartbeat-conflict", "LEASE"], ["old-output", "DOCUMENT"], ["equal-files", "DOCUMENT"], ["detached-output", "DOCUMENT"]
] as const)("stops %s without any submission or lease replacement", async (mode, phase) => {
  const f = fixture(mode);
  await expect(runTask12GeneratedDocument(f.input, f.port)).rejects.toThrow("TASK12_GENERATED_DOCUMENT_" + phase);
  expect(f.trace.every(request => !request.path.endsWith("/submission") && !request.path.endsWith("/edit-lease"))).toBe(true);
});
