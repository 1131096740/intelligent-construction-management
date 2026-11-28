import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { once } from "node:events";
import { PDFDocument, StandardFonts } from "pdf-lib";
import PizZip from "pizzip";
import { claimTask12GeneratedDocumentOwnerReadback, readTask12GeneratedDocumentOutputs } from "./task12-generated-document-readback";
import { bindTask12PublishedMaterialTemplate, runTask12GeneratedDocument, verifyTask12MaterialTemplate } from "./task12-generated-document-seam";

const [versionId, layoutId, generationId, docxFileId, pdfFileId, sourceFileId, actorId] = Array.from({ length: 7 },
  (_, i) => "10000000-0000-4000-8000-00000000000" + (i + 1));
const fingerprint = "a".repeat(64);
const password = "d".repeat(64);
const accessToken = "fixture.token.hmac";
const token = "x".repeat(43);
const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const pdfMime = "application/pdf";
const fields = { contractName: "Saved material contract", ownerName: "Original buyer", counterpartyName: "Original seller" };

async function generation() {
  const master = verifyTask12MaterialTemplate(readFileSync(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx")));
  const previewJobId = "10000000-0000-4000-8000-000000000008", previewPdfFileId = "10000000-0000-4000-8000-000000000009";
  const source = { sourceFileId, sourceSha256: master.sha256, draftRevision: 2 };
  const template = bindTask12PublishedMaterialTemplate(master, { id: sourceFileId, sizeBytes: master.bytes, contentSha256: master.sha256 },
    { id: layoutId, docxFileId: sourceFileId, status: "published", draftRevision: 2, previewPdfFileId, placeholderSchema: {
      sourceMapping: { ...source, protocolVersion: 1, bindings: [], fingerprint, confirmation: {
        ...source, mappingFingerprint: fingerprint, previewJobId, previewPdfFileId
      } }
    } });
  const now = Date.parse("2026-11-12T08:00:00Z"), expiresAt = new Date(now + 120_000).toISOString();
  const trace = { sourceRevision: 4, documentContentRevision: 3, documentContentFingerprint: fingerprint };
  return runTask12GeneratedDocument({ template, versionId, ...trace, lease: { token, leaseRevision: 1, expiresAt } }, {
    now: () => now, async wait() {},
    async send(request) {
      return request.method === "POST" ? { status: 201, body: { ...trace, generationId, status: "queued" } } :
        { status: 200, body: { version: { id: versionId, layoutTemplateVersionId: layoutId, draftRevision: 4,
          documentContentRevision: 3, documentContentFingerprint: fingerprint, latestDraftPreviewDocumentId: generationId, status: "draft" },
        lease: { state: "held_by_me", expiresAt }, documents: [{
          ...trace, id: generationId, purpose: "draft", status: "success", docxFileId, pdfFileId
        }] } };
    }
  });
}

const anchor = "第二条质量技术标准及相关要求";
function wordBytes(withPackage = true) {
  const zip = new PizZip();
  if (withPackage) {
    zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  }
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    [fields.contractName, "甲方：" + fields.ownerName, "乙方：" + fields.counterpartyName, anchor].map(text => "<w:p><w:r><w:t>" + text + "</w:t></w:r></w:p>").join("") + "</w:body></w:document>");
  return zip.generate({ type: "nodebuffer" });
}

async function pdfBytes() {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  page.drawText(Object.values(fields).join(" / "), { font: await doc.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await doc.save());
}

async function withPublicFiles<T>(mode: string, consume: (port: number, trace: string[], pdf: Buffer, docx: Buffer) => Promise<T>) {
  const docx = wordBytes(mode !== "missing-opc"), pdf = mode === "damaged-pdf" ? Buffer.from("%PDF-1.7 invalid") : await pdfBytes();
  const trace: string[] = [];
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => { response.writeHead(500).end(); });
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url!, "http://127.0.0.1");
    trace.push(request.method + " " + url.pathname);
    const json = (status: number, body: unknown) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    const fileId = url.pathname.split("/")[2];
    const isPdf = fileId === pdfFileId, accessMode = isPdf ? "preview" : "download";
    const mimeType = isPdf ? pdfMime : docxMime;
    const bytes = isPdf ? pdf : docx;
    const sizeBytes = bytes.length;
    if (![docxFileId, pdfFileId].includes(fileId)) return json(404, {});
    if (url.pathname.endsWith("/download-ticket-capability")) {
      if (request.headers.authorization !== "Bearer " + accessToken) return json(401, {});
      return json(200, { action: { key: "create_private_file_download_ticket", enabled: true },
        availableActions: ["create_private_file_download_ticket"] });
    }
    if (url.pathname.endsWith("/download-ticket")) {
      if (request.headers.authorization !== "Bearer " + accessToken) return json(401, {});
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const input = JSON.parse(raw);
      expect(input).toEqual({ confirmationPassword: password, downloadReason: "隔离验收核对同修订Word与PDF", accessMode });
      const expiresAt = new Date(Date.now() + 299_000).toISOString();
      let downloadUrl = "/files/" + fileId + "/download?actorUserId=" + actorId + "&expiresAt=" + encodeURIComponent(expiresAt) +
        "&downloadReason=" + encodeURIComponent(input.downloadReason) + "&accessMode=" + accessMode + "&token=" + token;
      if (mode === "external") downloadUrl = "http://127.0.0.1:1" + downloadUrl;
      if (mode === "other-file") downloadUrl = downloadUrl.replace(fileId, actorId);
      if (mode === "duplicate") downloadUrl += "&token=" + token;
      return json(201, { fileId, mimeType, sizeBytes, expiresAt, downloadUrl, fileName: isPdf ? "draft.pdf" : "draft.docx" });
    }
    expect(request.headers.authorization).toBeUndefined();
    if (mode === "redirect") return response.writeHead(302, { Location: "/unexpected" }).end();
    return response.writeHead(200, {
      "Content-Type": mode === "mime" ? "text/html" : mimeType,
      "Content-Length": String(mode === "size" ? sizeBytes + 1 : sizeBytes),
      "Content-Disposition": (isPdf ? "inline" : "attachment") + "; filename*=UTF-8''draft." + (isPdf ? "pdf" : "docx")
    }).end(bytes);
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server address");
    return await consume(address.port, trace, pdf, docx);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
}

it("reads both exact protected files and emits only the owner readback coordinates", async () => {
  await withPublicFiles("normal", async (port, trace, pdf, docx) => {
    const ownerScope = Object.freeze({});
    const result = await readTask12GeneratedDocumentOutputs(await generation(), {
      port, ownerScope, actorId, accessToken, confirmationPassword: password, fields,
      readPdfDrawnText: async bytes => {
        expect(bytes).toEqual(pdf);
        return [[fields.contractName, "甲方：" + fields.ownerName, "乙方：" + fields.counterpartyName, anchor].join(" ")];
      }
    });
    expect(result).toMatchObject({ status: "DRAFT_WORD_PDF_PUBLIC_READBACK_MATCHED", generationId, layoutId, versionId,
      files: {
        docx: { fileId: docxFileId, mimeType: docxMime, sha256: createHash("sha256").update(docx).digest("hex") },
        pdf: { fileId: pdfFileId, mimeType: pdfMime, pageCount: 1, sizeBytes: pdf.length, sha256: createHash("sha256").update(pdf).digest("hex") }
      },
      ownerExpectation: { actorId, sourceRevision: 4, documentContentRevision: 3, documentContentFingerprint: fingerprint }
    });
    expect(trace).toEqual([docxFileId, pdfFileId].flatMap(id => [
      "GET /files/" + id + "/download-ticket-capability", "POST /files/" + id + "/download-ticket", "GET /files/" + id + "/download"
    ]));
    expect(() => claimTask12GeneratedDocumentOwnerReadback({}, result)).toThrow("TASK12_GENERATED_DOCUMENT_READBACK_OWNER_PROOF");
    expect(() => claimTask12GeneratedDocumentOwnerReadback(ownerScope, { ...result })).toThrow("TASK12_GENERATED_DOCUMENT_READBACK_OWNER_PROOF");
    expect(claimTask12GeneratedDocumentOwnerReadback(ownerScope, result)).toBe(result);
    expect(() => claimTask12GeneratedDocumentOwnerReadback(ownerScope, result)).toThrow("TASK12_GENERATED_DOCUMENT_READBACK_OWNER_PROOF");
    const serialized = JSON.stringify(result);
    for (const privateValue of [accessToken, password, token, fields.contractName]) expect(serialized).not.toContain(privateValue);
  });
});


it.each([
  ["external", "TICKET", 2], ["other-file", "TICKET", 2], ["duplicate", "TICKET", 2],
  ["redirect", "DOWNLOAD", 3], ["mime", "DOWNLOAD", 3], ["size", "DOWNLOAD", 3]
] as const)("stops %s before reading a second file and preserves the fixed failure", async (mode, stage, count) => {
  await withPublicFiles(mode, async (port, trace) => {
    const parser = jest.fn();
    await expect(readTask12GeneratedDocumentOutputs(await generation(), {
      port, actorId, accessToken, confirmationPassword: password, fields, readPdfDrawnText: parser
    })).rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_READBACK_" + stage });
    expect(trace).toHaveLength(count);
    expect(trace.every(call => !call.includes(pdfFileId))).toBe(true);
    expect(parser).not.toHaveBeenCalled();
  });
});

it("rejects an independently parsed PDF that reverses the buyer and seller", async () => {
  await withPublicFiles("normal", async (port, trace) => {
    await expect(readTask12GeneratedDocumentOutputs(await generation(), {
      port, actorId, accessToken, confirmationPassword: password, fields,
      readPdfDrawnText: async () => [[fields.contractName, "甲方：" + fields.counterpartyName, "乙方：" + fields.ownerName, anchor].join(" ")]
    })).rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_READBACK_PDF_FIELDS" });
    expect(trace).toHaveLength(6);
  });
});

it("rejects a detached copy of the coordinates before requesting a ticket", async () => {
  await withPublicFiles("normal", async (port, trace) => {
    await expect(readTask12GeneratedDocumentOutputs({ ...await generation() }, {
      port, actorId, accessToken, confirmationPassword: password, fields, readPdfDrawnText: jest.fn()
    })).rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_READBACK_INPUT" });
    expect(trace).toEqual([]);
  });
});


it("rejects bytes with a PDF signature but no parseable document before reading drawn text", async () => {
  await withPublicFiles("damaged-pdf", async (port, trace) => {
    const parser = jest.fn();
    await expect(readTask12GeneratedDocumentOutputs(await generation(), {
      port, actorId, accessToken, confirmationPassword: password, fields, readPdfDrawnText: parser
    })).rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_READBACK_PDF" });
    expect(trace).toHaveLength(6);
    expect(parser).not.toHaveBeenCalled();
  });
});


it("rejects a ZIP with Word body text but no DOCX package before requesting PDF", async () => {
  await withPublicFiles("missing-opc", async (port, trace) => {
    await expect(readTask12GeneratedDocumentOutputs(await generation(), {
      port, actorId, accessToken, confirmationPassword: password, fields, readPdfDrawnText: jest.fn()
    })).rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_READBACK_DOCX" });
    expect(trace).toHaveLength(3);
  });
});
