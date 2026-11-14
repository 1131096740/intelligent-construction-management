import { prepareLayoutSourceMapping, readLayoutSourcePositions, type LayoutFieldBinding } from "../contract-template/layout-field-mapping";
import { bindTask12PublishedMaterialTemplate, verifyTask12MaterialTemplate } from "./task12-generated-document-seam";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const POLL_MS = 1000;
const PREVIEW_TIMEOUT_MS = 130_000;
const reviewedFields = [
  ["{合同名称}", "contract.name", 2],
  ["{甲方名称}", "party.owner.name", 3],
  ["{乙方名称}", "party.counterparty.name", 3],
  ["{草稿编号}", "contract.temporaryCode", 1],
  ["{文档水印}", "document.watermark", 1]
] as const;

type VersionPath = `/contract-layout-template-versions/${string}`;
type MappingInput = { expectedRevision: number; sourceFileId: string; sourceSha256: string; mappingFingerprint: string };

export type Task12MaterialTemplateRequest =
  | { method: "POST"; path: "/files"; form: FormData }
  | { method: "POST"; path: "/contract-layout-templates"; json: { name: string; contractTypeKey: "material_purchase"; docxFileId: string; placeholderSchema: { bills: [{ key: "materials" }] } } }
  | { method: "GET"; path: `${VersionPath}/source-positions` | `${VersionPath}/preview-generation` }
  | { method: "PATCH"; path: `${VersionPath}/source-mapping`; json: Omit<MappingInput, "mappingFingerprint"> & { bindings: readonly LayoutFieldBinding[] } }
  | { method: "POST"; path: `${VersionPath}/inspection` | `${VersionPath}/submission` }
  | { method: "POST"; path: `${VersionPath}/preview-generation`; json: Readonly<Record<string, unknown>> }
  | { method: "POST"; path: `${VersionPath}/source-mapping-confirmation`; json: MappingInput }
  | { method: "POST"; path: `${VersionPath}/publication`; json: { changeSummary: string } };

interface Port {
  /** Private, bounded same-application transport authenticated as the seeded contract director. */
  send(request: Task12MaterialTemplateRequest): Promise<{ status: number; body: unknown }>;
  now(): number;
  wait(ms: number): Promise<void>;
}

function requireStage(value: unknown, stage: string): asserts value {
  if (!value) {
    const code = "TASK12_GENERATED_MATERIAL_TEMPLATE_" + stage;
    throw Object.assign(new Error(code), { code });
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function reviewedBindings(positions: ReturnType<typeof readLayoutSourcePositions>["positions"]) {
  return reviewedFields.flatMap(([token, fieldKey, count]) => {
    const bindings: LayoutFieldBinding[] = [];
    for (const position of positions) {
      let start = position.text.indexOf(token);
      while (start !== -1) {
        bindings.push({ positionId: position.positionId, start, end: start + token.length, fieldKey });
        start = position.text.indexOf(token, start + token.length);
      }
    }
    requireStage(bindings.length === count, "MAPPING");
    return bindings;
  });
}

const previewSample = {
  contract: { name: "隔离材料样张", temporaryCode: "T12-MATERIAL-SAMPLE", amountUppercase: "壹佰壹拾叁元整" },
  party: { owner: { name: "样张甲方" }, counterparty: { name: "样张乙方" } },
  document: { watermark: "样张" },
  bill: { materials: [{ itemName: "样张材料", specification: "样张规格", unit: "件", quantity: "1", taxInclusiveUnitPrice: "113.0000", taxInclusiveAmount: "113.0000" }] }
} as const;

/** Public lifecycle of the fixed reviewed source inside the owned document application. */
export async function publishTask12GeneratedMaterialTemplate(source: Uint8Array, directorId: string, port: Port) {
  requireStage(isId(directorId) && source instanceof Uint8Array, "INPUT");
  const bytes = Buffer.from(source);
  const verified = verifyTask12MaterialTemplate(bytes);
  const parsed = readLayoutSourcePositions(bytes);
  const bindings = reviewedBindings(parsed.positions);

  async function send(request: Task12MaterialTemplateRequest, status: number, stage: string) {
    let response: Awaited<ReturnType<Port["send"]>>;
    try {
      response = await port.send(request);
    } catch {
      requireStage(false, stage);
    }
    requireStage(response.status === status, stage);
    return object(response.body);
  }

  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(bytes)], { type: DOCX }), "material-purchase-real-v1.docx");
  const upload = await send({ method: "POST", path: "/files", form }, 201, "UPLOAD");
  const sourceFileId = upload.id;
  requireStage(isId(sourceFileId) && upload.uploadedByUserId === directorId &&
    upload.contentSha256 === verified.sha256 && upload.sizeBytes === verified.bytes, "UPLOAD");

  const created = await send({ method: "POST", path: "/contract-layout-templates", json: {
    name: "隔离验收材料采购版式", contractTypeKey: "material_purchase", docxFileId: sourceFileId,
    placeholderSchema: { bills: [{ key: "materials" }] }
  } }, 201, "CREATE");
  const templateId = object(created.template).id;
  const version = object(created.version);
  const layoutId = version.id;
  requireStage(isId(templateId) && isId(layoutId) && new Set([sourceFileId, templateId, layoutId]).size === 3 &&
    version.layoutTemplateId === templateId && version.docxFileId === sourceFileId &&
    version.status === "draft" && version.draftRevision === 1, "CREATE");
  const path: VersionPath = `/contract-layout-template-versions/${layoutId}`;

  const positions = await send({ method: "GET", path: `${path}/source-positions` }, 200, "POSITIONS");
  requireStage(positions.versionId === layoutId && positions.sourceFileId === sourceFileId &&
    positions.sourceSha256 === verified.sha256 && positions.draftRevision === 1 &&
    positions.confirmed === false && positions.mappingFingerprint === null &&
    Array.isArray(positions.bindings) && positions.bindings.length === 0 &&
    Array.isArray(positions.positions) && positions.positions.length === parsed.positions.length &&
    positions.positions.every((value: unknown, index: number) => {
      const actual = object(value), expected = parsed.positions[index];
      return actual.positionId === expected.positionId && actual.part === expected.part &&
        actual.paragraphIndex === expected.paragraphIndex && actual.text === expected.text;
    }), "POSITIONS");

  const expectedRevision = 2;
  const sourceSha256 = verified.sha256;
  const { mapping } = prepareLayoutSourceMapping(bytes, sourceFileId, expectedRevision, bindings);
  const mapped = await send({ method: "PATCH", path: `${path}/source-mapping`, json: {
    expectedRevision: 1, sourceFileId, sourceSha256, bindings: mapping.bindings
  } }, 200, "MAPPING");
  requireStage(mapped.draftRevision === expectedRevision && mapped.mappingFingerprint === mapping.fingerprint &&
    mapped.confirmed === false, "MAPPING");
  const inspected = await send({ method: "POST", path: `${path}/inspection` }, 201, "INSPECTION");
  requireStage(inspected.sourceRevision === expectedRevision && inspected.hasBillLoop === true &&
    Array.isArray(inspected.blockingErrors) && inspected.blockingErrors.length === 0, "INSPECTION");

  const start = port.now(), deadline = start + PREVIEW_TIMEOUT_MS;
  requireStage(Number.isSafeInteger(start) && Number.isSafeInteger(deadline), "TIME");
  let previousTime = start;
  function checkTime() {
    const time = port.now();
    requireStage(Number.isSafeInteger(time) && time >= previousTime && time < deadline, "TIME");
    previousTime = time;
  }

  const queued = await send({ method: "POST", path: `${path}/preview-generation`, json: previewSample }, 201, "QUEUE");
  const previewJobId = queued.id;
  requireStage(isId(previewJobId) && ![sourceFileId, templateId, layoutId].includes(previewJobId) &&
    queued.layoutTemplateVersionId === layoutId && queued.sourceRevision === expectedRevision &&
    queued.createdByUserId === directorId && queued.status === "queued" && queued.previewPdfFileId === null, "QUEUE");
  let previewPdfFileId: string | undefined;
  for (let attempt = 0; attempt < PREVIEW_TIMEOUT_MS / POLL_MS; attempt++) {
    checkTime();
    const preview = await send({ method: "GET", path: `${path}/preview-generation` }, 200, "PREVIEW");
    checkTime();
    requireStage(preview.id === previewJobId && preview.layoutTemplateVersionId === layoutId &&
      preview.sourceRevision === expectedRevision && preview.createdByUserId === directorId, "PREVIEW");
    if (preview.status === "succeeded") {
      const fileId = preview.previewPdfFileId;
      requireStage(isId(fileId) && ![sourceFileId, templateId, layoutId, previewJobId].includes(fileId) &&
        preview.errorMessage === null && typeof preview.startedAt === "string" && typeof preview.completedAt === "string" &&
        Number.isFinite(Date.parse(preview.startedAt)) && Date.parse(preview.completedAt) >= Date.parse(preview.startedAt), "PREVIEW");
      previewPdfFileId = fileId;
      break;
    }
    requireStage((preview.status === "queued" || preview.status === "processing") && preview.previewPdfFileId === null, "PREVIEW");
    await port.wait(POLL_MS);
  }
  requireStage(previewPdfFileId, "TIME");

  const confirmed = await send({ method: "POST", path: `${path}/source-mapping-confirmation`, json: {
    expectedRevision, sourceFileId, sourceSha256, mappingFingerprint: mapping.fingerprint
  } }, 201, "CONFIRM");
  requireStage(confirmed.confirmed === true && confirmed.draftRevision === expectedRevision &&
    confirmed.previewPdfFileId === previewPdfFileId, "CONFIRM");
  const submitted = await send({ method: "POST", path: `${path}/submission` }, 201, "SUBMIT");
  requireStage(submitted.id === layoutId && submitted.layoutTemplateId === templateId && submitted.docxFileId === sourceFileId &&
    submitted.status === "submitted" && submitted.draftRevision === expectedRevision &&
    submitted.submittedByUserId === directorId, "SUBMIT");

  const published = await send({ method: "POST", path: `${path}/publication`, json: {
    changeSummary: "隔离验收真实材料版式的源文件、填写位置和样张"
  } }, 201, "PUBLISH");
  const schema = object(published.placeholderSchema);
  const storedMapping = object(schema.sourceMapping);
  const confirmation = object(storedMapping.confirmation);
  requireStage(published.id === layoutId && published.layoutTemplateId === templateId &&
    published.draftRevision === expectedRevision && published.publishedByUserId === directorId &&
    published.previewPdfFileId === previewPdfFileId && storedMapping.fingerprint === mapping.fingerprint &&
    Array.isArray(schema.bills) && schema.bills.length === 1 && object(schema.bills[0]).key === "materials" &&
    Array.isArray(storedMapping.bindings) && storedMapping.bindings.length === mapping.bindings.length &&
    storedMapping.bindings.every((value: unknown, index: number) => {
      const actual = object(value), expected = mapping.bindings[index];
      return actual.positionId === expected.positionId && actual.start === expected.start &&
        actual.end === expected.end && actual.fieldKey === expected.fieldKey;
    }) && confirmation.previewJobId === previewJobId && confirmation.actorUserId === directorId, "PUBLISH");
  return bindTask12PublishedMaterialTemplate(verified, upload, published);
}
