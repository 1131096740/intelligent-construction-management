import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PizZip from "pizzip";
import { declaredBillKeys, requiredPlaceholderKeys } from "../contract-document/contract-document.service";
import { renderLayoutPreviewDocx } from "../contract-document/layout-preview-docx";
import { layoutPreviewValues } from "../contract-document/layout-preview-values";
import { prepareLayoutSourceMapping, readLayoutSourcePositions } from "../contract-template/layout-field-mapping";
import { publishTask12GeneratedMaterialTemplate } from "./task12-generated-material-template";

const source = readFileSync(resolve(__dirname, "../../assets/templates/material-purchase-real-v1.docx"));
const hash = "44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd";
const sourceFileId = "10000000-0000-4000-8000-000000000001";
const templateId = "10000000-0000-4000-8000-000000000002";
const layoutId = "10000000-0000-4000-8000-000000000003";
const previewJobId = "10000000-0000-4000-8000-000000000004";
const previewPdfFileId = "10000000-0000-4000-8000-000000000005";
const base = "/contract-layout-template-versions/" + layoutId;
const directorId = "10000000-0000-4000-8000-000000000006";
type Request = Parameters<Parameters<typeof publishTask12GeneratedMaterialTemplate>[2]["send"]>[0];

function publicTemplatePort(alter?: (request: Request, value: unknown) => unknown) {
  const calls: string[] = [];
  let now = 1000, previewReads = 0;
  let mapping: ReturnType<typeof prepareLayoutSourceMapping>["mapping"] | undefined;
  const preview = { id: previewJobId, layoutTemplateVersionId: layoutId, sourceRevision: 2, createdByUserId: directorId, previewPdfFileId: null };
  const version = { id: layoutId, layoutTemplateId: templateId, docxFileId: sourceFileId };
  const port = {
    now: () => now,
    wait: async (ms: number) => { now += ms; },
    async send(request: Request) {
      const route = request.method + " " + request.path;
      calls.push(route);
      const respond = (status: number, body: unknown) => ({ status, body: alter ? alter(request, body) : body });
      switch (route) {
        case "POST /files": {
          expect(request).toHaveProperty("form");
          if (!("form" in request)) throw new Error("multipart missing");
          const file = request.form.get("file");
          expect(file).toBeInstanceOf(Blob);
          if (!(file instanceof Blob)) throw new Error("DOCX missing");
          expect(Buffer.from(await file.arrayBuffer())).toEqual(source);
          expect(file.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
          return respond(201, { id: sourceFileId, contentSha256: hash, sizeBytes: 29389, uploadedByUserId: directorId });
        }
        case "POST /contract-layout-templates":
          expect(request).toMatchObject({ json: { contractTypeKey: "material_purchase", docxFileId: sourceFileId, placeholderSchema: { bills: [{ key: "materials" }] } } });
          return respond(201, { template: { id: templateId }, version: { ...version, status: "draft", draftRevision: 1 } });
        case "GET " + base + "/source-positions":
          return respond(200, { ...readLayoutSourcePositions(source), versionId: layoutId, sourceFileId, draftRevision: 1, confirmed: false, mappingFingerprint: null, bindings: [] });
        case "PATCH " + base + "/source-mapping": {
          if (request.method !== "PATCH") throw new Error("mapping request missing");
          expect(request.json).toMatchObject({ expectedRevision: 1, sourceFileId, sourceSha256: hash });
          expect(request.json.bindings.map(binding => binding.fieldKey).sort()).toEqual([
            "contract.name", "contract.name", "contract.temporaryCode", "document.watermark",
            "party.counterparty.name", "party.counterparty.name", "party.counterparty.name",
            "party.owner.name", "party.owner.name", "party.owner.name"
          ]);
          mapping = prepareLayoutSourceMapping(source, sourceFileId, 2, request.json.bindings).mapping;
          return respond(200, { draftRevision: 2, mappingFingerprint: mapping.fingerprint, confirmed: false });
        }
        case "POST " + base + "/inspection":
          return respond(201, { sourceRevision: 2, blockingErrors: [], hasBillLoop: true });
        case "POST " + base + "/preview-generation":
          return respond(201, { ...preview, status: "queued" });
        case "GET " + base + "/preview-generation":
          return ++previewReads === 1 ? respond(200, { ...preview, status: "processing" }) :
            respond(200, { ...preview, status: "succeeded", previewPdfFileId, errorMessage: null, startedAt: "2026-11-12T00:00:00.000Z", completedAt: "2026-11-12T00:00:01.000Z" });
        case "POST " + base + "/source-mapping-confirmation":
          expect(request).toMatchObject({ json: { expectedRevision: 2, sourceFileId, sourceSha256: hash, mappingFingerprint: mapping?.fingerprint } });
          return respond(201, { draftRevision: 2, confirmed: true, previewPdfFileId });
        case "POST " + base + "/submission":
          return respond(201, { ...version, status: "submitted", draftRevision: 2, submittedByUserId: directorId });
        case "POST " + base + "/publication":
          return respond(201, { ...version, status: "published", draftRevision: 2, previewPdfFileId, publishedByUserId: directorId, placeholderSchema: {
            bills: [{ key: "materials" }], sourceMapping: { ...mapping, confirmation: {
              sourceFileId, sourceSha256: hash, draftRevision: 2, mappingFingerprint: mapping?.fingerprint, previewJobId, previewPdfFileId, actorUserId: directorId
            } }
          } });
        default: throw new Error("unexpected route " + route);
      }
    }
  };
  return { port, calls };
}

describe("Task12 reviewed material template public lifecycle", () => {
  it("uploads the physical master, waits for the exact preview and binds the published layout", async () => {
    const { port, calls } = publicTemplatePort();
    await expect(publishTask12GeneratedMaterialTemplate(source, directorId, port)).resolves.toEqual({ layoutId, sourceFileId, sourceSha256: hash });
    expect(calls).toEqual([
      "POST /files", "POST /contract-layout-templates", "GET " + base + "/source-positions",
      "PATCH " + base + "/source-mapping", "POST " + base + "/inspection", "POST " + base + "/preview-generation",
      "GET " + base + "/preview-generation", "GET " + base + "/preview-generation",
      "POST " + base + "/source-mapping-confirmation", "POST " + base + "/submission", "POST " + base + "/publication"
    ]);
  });
  it("renders the fixed preview request through the original DOCX renderer with the reviewed master", async () => {
    let mappedSource: Buffer | undefined;
    let rendered: Buffer | undefined;
    const schema = { bills: [{ key: "materials" }] };
    const { port } = publicTemplatePort((request, body) => {
      if (request.method === "PATCH") {
        mappedSource = prepareLayoutSourceMapping(source, sourceFileId, 2, request.json.bindings).docx;
      }
      if (request.method === "POST" && "json" in request && request.path.endsWith("/preview-generation")) {
        if (!mappedSource) throw new Error("mapped master missing");
        rendered = renderLayoutPreviewDocx(mappedSource,
          { values: layoutPreviewValues(request.json, declaredBillKeys(schema)) }, requiredPlaceholderKeys(schema));
      }
      return body;
    });
    await publishTask12GeneratedMaterialTemplate(source, directorId, port);
    if (!rendered) throw new Error("preview DOCX missing");
    const preview = new PizZip(rendered);
    const body = preview.file("word/document.xml")!.asText();
    expect(body).toContain("隔离材料样张");
    expect(body).toContain("样张甲方");
    expect(body).toContain("样张乙方");
    expect(body).toContain("样张材料");
    expect(body).toContain("113.0000");
    expect(preview.file("word/header1.xml")!.asText()).toContain("样张");
  });

  it.each([
    ["POST", "/files", "UPLOAD", { contentSha256: "0".repeat(64) }],
    ["GET", base + "/source-positions", "POSITIONS", { positions: [] }],
    ["PATCH", base + "/source-mapping", "MAPPING", { mappingFingerprint: "0".repeat(64) }],
    ["POST", base + "/inspection", "INSPECTION", { blockingErrors: ["未通过"] }],
    ["GET", base + "/preview-generation", "PREVIEW", { id: templateId, status: "succeeded", previewPdfFileId }],
    ["GET", base + "/preview-generation", "PREVIEW", { sourceRevision: 1 }],
    ["GET", base + "/preview-generation", "PREVIEW", { status: "failed" }],
    ["POST", base + "/source-mapping-confirmation", "CONFIRM", { previewPdfFileId: templateId }],
    ["POST", base + "/submission", "SUBMIT", { submittedByUserId: templateId }],
    ["POST", base + "/publication", "PUBLISH", { previewPdfFileId: templateId }]
  ] as const)("stops after %s %s when %s proof differs", async (method, path, stage, change) => {
    const { port, calls } = publicTemplatePort((request, body) =>
      request.method === method && request.path === path ? { ...body as object, ...change } : body);
    await expect(publishTask12GeneratedMaterialTemplate(source, directorId, port))
      .rejects.toMatchObject({ code: "TASK12_GENERATED_MATERIAL_TEMPLATE_" + stage });
    expect(calls.at(-1)).toBe(method + " " + path);
  });

  it("rejects a publication that claims the old fingerprint after changing a binding", async () => {
    const { port } = publicTemplatePort((request, body) => {
      if (!request.path.endsWith("/publication")) return body;
      const publication = body as { placeholderSchema: { sourceMapping: { bindings: Array<{ start: number }> } } };
      const mapping = publication.placeholderSchema.sourceMapping;
      const [first, ...rest] = mapping.bindings;
      return { ...publication, placeholderSchema: { ...publication.placeholderSchema,
        sourceMapping: { ...mapping, bindings: [{ ...first, start: first.start + 1 }, ...rest] }
      } };
    });
    await expect(publishTask12GeneratedMaterialTemplate(source, directorId, port))
      .rejects.toMatchObject({ code: "TASK12_GENERATED_MATERIAL_TEMPLATE_PUBLISH" });
  });

  it("rejects different physical source bytes before uploading", async () => {
    const { port, calls } = publicTemplatePort();
    await expect(publishTask12GeneratedMaterialTemplate(Buffer.from("different DOCX"), directorId, port))
      .rejects.toMatchObject({ code: "TASK12_GENERATED_DOCUMENT_TEMPLATE" });
    expect(calls).toEqual([]);
  });

  it("bounds the preview wait without confirming, retrying mutations or extending the budget", async () => {
    const { port, calls } = publicTemplatePort((request, body) => request.method === "GET" &&
      request.path.endsWith("/preview-generation") ? { ...body as object, status: "processing", previewPdfFileId: null } : body);
    await expect(publishTask12GeneratedMaterialTemplate(source, directorId, port))
      .rejects.toMatchObject({ code: "TASK12_GENERATED_MATERIAL_TEMPLATE_TIME" });
    expect(calls.filter(call => call === "POST " + base + "/preview-generation")).toHaveLength(1);
    expect(calls.filter(call => call === "GET " + base + "/preview-generation")).toHaveLength(130);
    expect(calls.some(call => call.endsWith("/source-mapping-confirmation"))).toBe(false);
  });
});
