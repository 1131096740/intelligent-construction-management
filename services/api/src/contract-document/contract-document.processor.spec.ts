import { unicodePathOverride } from "./builtin-template-parts.test-support";
import * as layoutMappingApi from "../contract-template/layout-field-mapping";
jest.mock("./mechanical-contact-layout",()=>({
  ...jest.requireActual("./mechanical-contact-layout"),
  applyMechanicalContactLayout:jest.fn((_source:Buffer,docx:Buffer)=>docx)
}));
jest.mock("./layout-preview-docx", () => ({
  renderLayoutPreviewDocx: (...args: unknown[]) => jest.requireMock("./contract-docx-renderer").renderContractDocx(...args)
}));
jest.mock("./contract-docx-renderer", () => ({
  renderContractDocx: jest.fn(() => Buffer.from("rendered-docx"))
}));
jest.mock("./libreoffice-converter", () => ({
  convertDocxToPdf: jest.fn(async () => Buffer.from("%PDF-converted"))
}));
jest.mock("./docx-attachment-appender", () => ({
  appendDocxImageAttachments: jest.fn(() => Buffer.from("docx-with-image-attachments"))
}));
jest.mock("./pdf-normalizer", () => ({
  ...jest.requireActual("./pdf-normalizer"),
  normalizeContractPdf: jest.fn(async () => ({
    buffer: Buffer.from("%PDF-normalized"),
    pageCount: 2,
    pageSizes: ["A4_portrait", "A4_landscape"],
    warnings: []
  }))
}));
jest.mock("./contract-docx-extractor", () => ({
  ...jest.requireActual("./contract-docx-extractor"),
  extractContractDocx: jest.fn((buffer: Buffer) => ({
    blocks: [{ kind: "paragraph", path: "p:000001", text: buffer.toString() }],
    normalizedSha256: buffer.toString()
  }))
}));
jest.mock("./contract-document-comparison", () => ({
  compareContractDocumentSnapshots: jest.fn(() => ({
    algorithmVersion: "contract-docx-patience-v1",
    baseNormalizedSha256: "base-hash",
    revisionNormalizedSha256: "revision-hash",
    differences: [
      {
        differenceKey: "difference-key",
        sortOrder: 1,
        changeType: "replace",
        kind: "paragraph",
        locationPath: "p:000001",
        basePath: "p:000001",
        revisedPath: "p:000001",
        beforeText: "before",
        afterText: "after",
        candidate: null
      }
    ]
  }))
}));

import PizZip from "pizzip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
function previewWordSource() {
  const zip = new PizZip();
  zip.file("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>template</w:t></w:r></w:p></w:body></w:document>');
  return zip.generate({ type: "nodebuffer" });
}

import { PrismaService } from "../database/prisma.service";
import { extractContractDocx } from "./contract-docx-extractor";
import { renderContractDocx } from "./contract-docx-renderer";
import { appendDocxImageAttachments } from "./docx-attachment-appender";
import { ContractDocumentProcessor } from "./contract-document.processor";
import { armCon18WorkerDiagnostic, takeCon18WorkerDiagnostic, closeCon18WorkerDiagnostic } from "./task12-con18-worker-diagnostic";
import { applyMechanicalContactLayout } from "./mechanical-contact-layout";
import { convertDocxToPdf } from "./libreoffice-converter";
import { normalizeContractPdf, UPLOAD_ORDERED_ATTACHMENTS_VERSION } from "./pdf-normalizer";
import * as bodyModule from "./contract-body-document";
import * as bodyConverter from "./contract-body-pdf-converter";
import { createHash } from "node:crypto";
import { LABOR_NAME_GLYPH_ERROR } from "./labor-font-coverage";

const mockedRender = renderContractDocx as jest.MockedFunction<typeof renderContractDocx>;
const mockedAppendDocxAttachments = appendDocxImageAttachments as jest.MockedFunction<
  typeof appendDocxImageAttachments
>;
const mockedConvert = convertDocxToPdf as jest.MockedFunction<typeof convertDocxToPdf>;
const mockedNormalize = normalizeContractPdf as jest.MockedFunction<
  typeof normalizeContractPdf
>;
const mockedExtract = extractContractDocx as jest.MockedFunction<
  typeof extractContractDocx
>;

describe("ContractDocumentProcessor", () => {
  const documentContentFingerprint = "a".repeat(64);
  const documentContentCoordinates = {
    documentContentRevision: 2,
    documentContentFingerprint
  };
  const audit = { record: jest.fn() };

  let convertedPdf: Buffer;
  beforeEach(async () => {
    jest.clearAllMocks();
    const validPdf = await PDFDocument.create();
    validPdf.addPage([595.28, 841.89]);
    convertedPdf = Buffer.from(await validPdf.save());
    mockedRender.mockReturnValue(Buffer.from("rendered-docx"));
    mockedAppendDocxAttachments.mockReturnValue(
      Buffer.from("docx-with-image-attachments")
    );
    mockedConvert.mockResolvedValue(convertedPdf);
    mockedNormalize.mockResolvedValue({
      buffer: Buffer.from("%PDF-normalized"),
      pageCount: 2,
      pageSizes: ["A4_portrait", "A4_landscape"],
      warnings: []
    });
    mockedExtract.mockImplementation((buffer) => ({
      blocks: [{ kind: "paragraph", path: "p:000001", text: buffer.toString() }],
      normalizedSha256: buffer.toString()
    }));
  });

  function makePrisma() {
    const tx = {
      contractLayoutPreviewJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractGeneratedDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(null)
      },
      contractOfflineRevision: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentComparison: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentDifference: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractNegotiationRound: {
        findUnique: jest.fn().mockResolvedValue({ id: "round-1", status: "open" })
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "layout-1", status: "draft", draftRevision: 2 })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({ id: "version-1", draftRevision: 3 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "company-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      $queryRaw: jest.fn().mockImplementation(
        async (query: { strings?: string[] }) => {
          const sql = query.strings?.join(" ") ?? "";
          if (sql.includes("FOR UPDATE OF cv")) {
            return [{
              id: "version-1",
              contractId: "contract-1",
              draftRevision: 3,
              ...documentContentCoordinates,
              status: "draft",
              changeType: "original",
              draftData: {}
            }];
          }
          if (sql.includes("FOR UPDATE OF c")) {
            return [{
              id: "contract-1",
              ownerUserId: "owner-1",
              voidedAt: null
            }];
          }
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
      ),
      auditLog: { create: jest.fn() }
    };
    return {
      contractLayoutPreviewJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractGeneratedDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractOfflineRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractDocumentComparison: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractVersion: { findUnique: jest.fn() },
      contractNegotiationRound: { findUnique: jest.fn() },
      contractLayoutTemplateVersion: { findUnique: jest.fn() },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx)
      ),
      tx
    };
  }

  function queuedDocument(overrides: Record<string, unknown> = {}) {
    return {
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date(),
      ...overrides
    };
  }

  it("allows a real processor to be stepped only after manual scheduling is opted in", async () => {
    jest.useFakeTimers();
    const prisma = makePrisma();
    const processor = ContractDocumentProcessor.forManualScheduling(prisma as unknown as PrismaService, {} as never, {} as never);
    const automatic = new ContractDocumentProcessor(prisma as unknown as PrismaService, {} as never, {} as never);
    const manualStep = jest.spyOn(processor, "processNext").mockResolvedValue(false);
    const automaticStep = jest.spyOn(automatic, "processNext").mockResolvedValue(false);
    try {
      processor.onApplicationBootstrap();
      automatic.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(2000);
      expect(automaticStep).toHaveBeenCalledTimes(2);
      expect(manualStep).not.toHaveBeenCalled();
      await processor.processNext();
      expect(manualStep).toHaveBeenCalledTimes(1);
    } finally {
      await processor.onApplicationShutdown();
      await automatic.onApplicationShutdown();
      jest.useRealTimers();
    }
  });

  it("publishes the qualified preview pointer inside the existing worker transaction", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    const original = prisma.tx.$queryRaw.getMockImplementation()!;
    prisma.tx.$queryRaw.mockImplementation(async (query: { strings?: string[] }) => {
      if (query.strings?.join(" ").includes("jg_publish_contract_preview_pointer_v1")) return [{ published: true }];
      return original(query);
    });
    const files = generatedDocumentFiles();
    const processor = ContractDocumentProcessor.forManualScheduling(prisma as unknown as PrismaService, files as never, audit as never, "ATOMIC_POINTER_V1");
    await processor.processNext();

    expect(prisma.tx.$queryRaw.mock.calls.some(([query]) => query.strings?.join(" ").includes("jg_publish_contract_preview_pointer_v1"))).toBe(true);
    expect(prisma.tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(prisma.tx, expect.objectContaining({ action: "contract.document.success" }));
  });

  function generatedDocumentFiles() {
    return {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
  }

  it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"].flatMap(filename=>["built-in-signature-supplement-v1","built-in-signature-supplement-company-v2","built-in-signature-supplement-company-v3","built-in-legacy-body-signature-v1"].map(version=>[filename,version])))("uses the frozen supplement version for %s (%s)",async(filename,version)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates",filename));
    const sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    const names={"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values:names},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:version}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined);
    const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockResolvedValue({pdf:convertedPdf,provenance:{}} as unknown as Awaited<ReturnType<typeof bodyConverter.convertContractBodyDocxToPdf>>);
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
      expect(body).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.anything(),expect.anything(),undefined,expect.objectContaining({partyDetailsVersion:version}));
      expect(convert).toHaveBeenCalled();
    } finally {lock.mockRestore();body.mockRestore();convert.mockRestore();}
  });

  it("accepts only guarded company-bank-binding snapshot versions",()=>{
    const base=queuedDocument().inputSnapshot;
    const parse=(value:unknown)=>(new ContractDocumentProcessor({} as never,{} as never,{} as never) as unknown as {documentSnapshot:(input:unknown)=>unknown}).documentSnapshot(value);
    const marker="built-in-company-bank-binding-v1:";
    const inner="built-in-legacy-signature-bank-v1";
    expect(()=>parse({...base,partyDetailsVersion:`built-in-automatic-party-guard-v1:${marker}${inner}`})).not.toThrow();
    expect(()=>parse({...base,partyDetailsVersion:`${marker}${inner}`})).toThrow("合同文档输入快照格式不正确");
    expect(()=>parse({...base,partyDetailsVersion:`built-in-automatic-party-guard-v1:${marker}unknown`})).toThrow("合同文档输入快照格式不正确");
    expect(()=>parse({...base,partyDetailsVersion:inner})).not.toThrow();
  });

  it("preserves historic labor versions and rejects abandoned image-placement snapshots",()=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),sourceSha256=createHash("sha256").update(source).digest("hex"),base=queuedDocument().inputSnapshot;
    const parse=(value:unknown)=>(new ContractDocumentProcessor({} as never,{} as never,{} as never) as unknown as {documentSnapshot:(input:unknown)=>unknown}).documentSnapshot(value);
    const body={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64)};
    for(const [tag,asBody] of [["built-in-labor-signature-review-v3",true],["built-in-labor-signature-legacy-v3",false]] as const){const snapshot={...base,...(asBody?{bodyDocument:{...body,partyDetailsVersion:tag}}:{partyDetailsVersion:tag})};expect(()=>parse(snapshot)).not.toThrow();expect(()=>parse({...snapshot,imagePlacementVersion:"built-in-image-before-signature-v1"})).toThrow("合同文档输入快照格式不正确");}
  });

  it.each([["material-purchase-real-v1.docx","built-in-signature-supplement-company-v3"],["equipment-rental-real-v1.docx","built-in-signature-supplement-company-v3"],["generic-contract-v1.docx","built-in-generic-signature-review-v3"],["labor-subcontract-real-v1.docx","built-in-labor-signature-review-v3"]])("appends attachments in the baseline path for %s",async(filename,version)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates",filename));
    const sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    const names={"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values:names},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:version}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined);
    const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockResolvedValue({pdf:convertedPdf,provenance:{}} as unknown as Awaited<ReturnType<typeof bodyConverter.convertContractBodyDocxToPdf>>);
    try{await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(body).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.anything(),expect.anything(),undefined,expect.not.objectContaining({preserveAttachmentAnchor:true}));expect(mockedAppendDocxAttachments).toHaveBeenCalledWith(expect.any(Buffer),expect.any(Array));expect(convert).toHaveBeenCalled();}
    finally {lock.mockRestore();body.mockRestore();convert.mockRestore();}
  });

  it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"].flatMap(filename=>[true,false].map(current=>[filename,current]))) ("routes only the frozen mapped supplement version for %s (%s)",async(filename,current)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates",filename as string)),sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    const names={"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
    const inputSnapshot = {
      ...job.inputSnapshot,
      ...(current ? { mappedSignatureVersion: "built-in-mapped-signature-supplement-v1" } : {}),
      renderInput: { values: names },
      bodyDocument: {
        protocolVersion: 1,
        layoutTemplateVersionId: "layout",
        sourceSha256,
        pdfEngine: "docx4j-17.3.5",
        runtimeLockSha256: "a".repeat(64),
        partyDetailsVersion: current
          ? "built-in-mapped-material-signature-v1"
          : "built-in-signature-supplement-company-v3"
      }
    };
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({ ...job, inputSnapshot });
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined);
    const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockResolvedValue({pdf:convertedPdf,provenance:{}} as unknown as Awaited<ReturnType<typeof bodyConverter.convertContractBodyDocxToPdf>>);
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService, files as never, audit as never).processNext();
      expect(body).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything(), undefined, expect.objectContaining({ mappedSignatureSupplement: current }));
      expect(convert).toHaveBeenCalled();
      expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: "success",
          inputSnapshot: { ...inputSnapshot, inspection: expect.any(Object) }
        })
      }));
    } finally {
      lock.mockRestore();
      body.mockRestore();
      convert.mockRestore();
    }
  });

  it.each([true,false])("routes generic mapped content without an image placement version (%s)",async current=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    const names={"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,...(current?{mappedSignatureVersion:"built-in-mapped-signature-supplement-v1"}:{}),renderInput:{values:names},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:current?"built-in-mapped-generic-body-v1":"built-in-generic-signature-review-v3"}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined);const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockResolvedValue({pdf:convertedPdf,provenance:{}} as unknown as Awaited<ReturnType<typeof bodyConverter.convertContractBodyDocxToPdf>>);
    try{await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(body).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.anything(),expect.anything(),undefined,expect.objectContaining({genericMappedSupplement:current}));expect(mockedAppendDocxAttachments).toHaveBeenCalledWith(expect.any(Buffer),expect.any(Array));expect(convert).toHaveBeenCalled();}
    finally{lock.mockRestore();body.mockRestore();convert.mockRestore();}
  });

  it.each([{mappedSignatureVersion:"unknown",partyDetailsVersion:"built-in-signature-supplement-company-v3"},{mappedSignatureVersion:"built-in-mapped-signature-supplement-v1",partyDetailsVersion:"built-in-party-placement-v1"}])("rejects incompatible mapped signature version: $mappedSignatureVersion",async input=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,mappedSignatureVersion:input.mappedSignatureVersion,renderInput:{values:{"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"}},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:input.partyDetailsVersion}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const body=jest.spyOn(bodyModule,"renderContractBody");try{await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(body).not.toHaveBeenCalled();expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed",errorMessage:"合同文档输入快照格式不正确"})}));}finally{body.mockRestore();}
  });

  it.each(["built-in-labor-party-glyph-v1","built-in-labor-party-glyph-banks-v2","built-in-labor-signature-review-v3","built-in-labor-party-v1"])("keeps docx4j font checking bound to the frozen labor version %s",async(version)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx"));
    const sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    const names={"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方","party.owner.openingBank":"虚构银行","party.counterparty.bankAccount":"虚构账号"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values:names},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:version}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined);
    const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockResolvedValue({pdf:convertedPdf,provenance:{}} as unknown as Awaited<ReturnType<typeof bodyConverter.convertContractBodyDocxToPdf>>);
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
      expect(convert).toHaveBeenCalledWith(expect.any(Buffer),"a".repeat(64),version.includes("glyph")||version==="built-in-labor-signature-review-v3"?expect.objectContaining({laborPartyNames:["虚构甲方","虚构乙方"]}):expect.not.objectContaining({laborPartyNames:expect.anything()}));
      if(version==="built-in-labor-party-glyph-banks-v2"||version==="built-in-labor-signature-review-v3") expect(convert).toHaveBeenCalledWith(expect.any(Buffer),"a".repeat(64),expect.objectContaining({laborBankValues:["虚构银行","虚构账号"]}));
      else expect(convert).toHaveBeenCalledWith(expect.any(Buffer),"a".repeat(64),expect.not.objectContaining({laborBankValues:expect.anything()}));
      expect(mockedConvert).not.toHaveBeenCalled();
    } finally {lock.mockRestore();body.mockRestore();convert.mockRestore();}
  });

  it.each([["material-purchase-real-v1.docx","built-in-legacy-signature-bank-v1"],["equipment-rental-real-v1.docx","built-in-legacy-signature-bank-v1"],["equipment-rental-real-v1.docx","built-in-legacy-mechanical-source-bound-v1"]])("renders legacy bank snapshot %s with version %s",async(filename,version)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates",filename)),prisma=makePrisma(),job=queuedDocument();
    const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲公司","party.counterparty.name":"虚构乙公司","party.owner.openingBank":"虚构甲开户行","party.owner.bankAccount":"A001","party.counterparty.openingBank":"虚构乙开户行","party.counterparty.bankAccount":"B001"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values},partyDetailsVersion:version}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const actual=jest.requireActual<typeof import("./contract-docx-renderer")>("./contract-docx-renderer");
    mockedRender.mockImplementation(actual.renderContractDocx);
    mockedAppendDocxAttachments.mockImplementation(docx=>docx);
    await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
    expect(mockedConvert).toHaveBeenCalledTimes(1);
    const output=mockedConvert.mock.calls[0][0],xml=new PizZip(output).file("word/document.xml")!.asText();
    for(const value of ["虚构甲开户行","A001","虚构乙开户行","B001"])expect(xml).toContain(value);
  });
  it("keeps the labor LibreOffice path independent of the docx4j glyph check",async()=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),prisma=makePrisma(),job=queuedDocument();
    const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values},partyDetailsVersion:"built-in-labor-party-v1"}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    mockedRender.mockReturnValue(source);
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock"),convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf");
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
      expect(mockedConvert).toHaveBeenCalledTimes(1);
      expect(lock).not.toHaveBeenCalled();expect(convert).not.toHaveBeenCalled();
    } finally {lock.mockRestore();convert.mockRestore();}
  });

  it.each([undefined,"libreoffice"])("rejects a glyph-version snapshot without the pinned docx4j engine (%s)",async(pdfEngine)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),prisma=makePrisma(),job=queuedDocument();
    const sourceSha256=createHash("sha256").update(source).digest("hex");
    const values={"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,partyDetailsVersion:"built-in-labor-party-glyph-v1",...(pdfEngine?{pdfEngine}:{})}}});
    const files=generatedDocumentFiles(),convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf");
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
      expect(files.getFileBuffer).not.toHaveBeenCalled();expect(files.uploadPrivateFile).not.toHaveBeenCalled();
      expect(mockedConvert).not.toHaveBeenCalled();expect(convert).not.toHaveBeenCalled();
      expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed",errorMessage:"合同文档输入快照格式不正确"})}));
    } finally {convert.mockRestore();}
  });

  it("keeps an older labor body snapshot without a PDF engine on the existing LibreOffice path",async()=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),prisma=makePrisma(),job=queuedDocument();
    const sourceSha256=createHash("sha256").update(source).digest("hex");
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,partyDetailsVersion:"built-in-labor-party-v1"}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf");
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
      expect(mockedConvert).toHaveBeenCalledTimes(1);expect(convert).not.toHaveBeenCalled();
    } finally {body.mockRestore();convert.mockRestore();}
  });

  it("records the safe glyph failure before uploading either output",async()=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx"));
    const sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    const names={"party.owner.name":"虚构𠮷公司","party.counterparty.name":"虚构乙方"};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,renderInput:{values:names},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:"built-in-labor-party-glyph-v1"}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined);
    const body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>);
    const convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockRejectedValue(new Error(LABOR_NAME_GLYPH_ERROR));
    try {
      await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
      expect(files.uploadPrivateFile).not.toHaveBeenCalled();
      expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed",errorMessage:LABOR_NAME_GLYPH_ERROR})}));
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain("虚构𠮷公司");
    } finally {lock.mockRestore();body.mockRestore();convert.mockRestore();}
  });

  it.each([undefined,"built-in-generic-font-v1"] as const)("binds generic font-table completion to the frozen version %s",async(version)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx"));
    const prisma=makePrisma(),job=queuedDocument();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,...(version?{genericFontTableVersion:version}:{})}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});
    mockedRender.mockReturnValue(source);mockedAppendDocxAttachments.mockReturnValue(source);
    const processor=new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never);
    await processor.processNext();
    expect(mockedConvert).toHaveBeenCalledTimes(1);
    const zip=new PizZip(mockedConvert.mock.calls[0][0]);
    const type=zip.file("[Content_Types].xml")!.asText();
    expect(type.includes('PartName="/word/fontTable.xml"')).toBe(Boolean(version));
  });
  it.each([
    ["material-purchase-real-v1.docx","built-in-mapped-material-signature-v1","built-in-signature-supplement-company-v3",true],
    ["equipment-rental-real-v1.docx","built-in-mapped-material-signature-v1","built-in-signature-supplement-company-v3",true],
    ["labor-subcontract-real-v1.docx","built-in-labor-signature-review-v3","built-in-labor-signature-review-v3",false],
    ["generic-contract-v1.docx","built-in-mapped-generic-body-v1","built-in-generic-signature-review-v3",true]
  ])("routes a verified repacked body snapshot for %s",async(filename,gate,canonical,mapped)=>{
    const original=readFileSync(join(__dirname,"../../assets/templates",filename)),zip=new PizZip(original);zip.comment="synthetic repack";const source=zip.generate({type:"nodebuffer"}),sourceSha256=createHash("sha256").update(source).digest("hex");
    const prisma=makePrisma(),job=queuedDocument();prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,...(mapped?{mappedSignatureVersion:"built-in-mapped-signature-supplement-v1"}:{}),...(filename.startsWith("generic")?{genericFontTableVersion:"built-in-equivalent-generic-font-v1"}:{}),renderInput:{values:{"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"}},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:`built-in-equivalent-v1:${gate}`}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});mockedAppendDocxAttachments.mockReturnValue(source);
    const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined),body=jest.spyOn(bodyModule,"renderContractBody").mockReturnValue({docx:source,sourceSha256,blocks:[],flow:[],paragraphGroups:[]} as unknown as ReturnType<typeof bodyModule.renderContractBody>),convert=jest.spyOn(bodyConverter,"convertContractBodyDocxToPdf").mockResolvedValue({pdf:convertedPdf,provenance:{}} as unknown as Awaited<ReturnType<typeof bodyConverter.convertContractBodyDocxToPdf>>);
    try{await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(body).toHaveBeenCalledWith(source,expect.anything(),expect.anything(),expect.anything(),expect.anything(),undefined,expect.objectContaining({partyDetailsVersion:canonical}));expect(convert).toHaveBeenCalledTimes(1);if(filename.startsWith("generic"))expect(new PizZip(convert.mock.calls[0][0]).file("[Content_Types].xml")!.asText()).toContain('PartName="/word/fontTable.xml"');}finally{lock.mockRestore();body.mockRestore();convert.mockRestore();}
  });
  it("rejects an unsafe automatic body mapping before rendering a guarded snapshot",async()=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),positions=layoutMappingApi.readLayoutSourcePositions(source),prisma=makePrisma(),job=queuedDocument();
    const bindings=positions.positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    const target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===51)!;bindings.push({positionId:target.positionId,start:0,end:3,fieldKey:"party.owner.name"});
    const layoutSourceMapping=layoutMappingApi.prepareLayoutSourceMapping(source,"layout-file",1,bindings).mapping;
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,layoutSourceMapping,mappedSignatureVersion:"built-in-mapped-signature-supplement-v1",renderInput:{values:{"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"}},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:positions.sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:"built-in-automatic-party-guard-v1:built-in-mapped-material-signature-v1"}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined),body=jest.spyOn(bodyModule,"renderContractBody");
    try{await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(body).not.toHaveBeenCalled();expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed"})}));}finally{lock.mockRestore();body.mockRestore();}
  });

  it.each(["extra", "unicode"])("rejects a %s forged equivalent snapshot before rendering",async kind=>{
    const original=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),zip=new PizZip(original);zip.file("forged-part","x");const source=kind==="unicode"?unicodePathOverride(original,"synthetic-styles.xml","word/styles.xml"):zip.generate({type:"nodebuffer"}),sourceSha256=createHash("sha256").update(source).digest("hex"),prisma=makePrisma(),job=queuedDocument();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,mappedSignatureVersion:"built-in-mapped-signature-supplement-v1",renderInput:{values:{"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"}},bodyDocument:{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256,pdfEngine:"docx4j-17.3.5",runtimeLockSha256:"a".repeat(64),partyDetailsVersion:"built-in-equivalent-v1:built-in-mapped-material-signature-v1"}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});const lock=jest.spyOn(bodyConverter,"assertContractBodyPdfRuntimeLock").mockResolvedValue(undefined),body=jest.spyOn(bodyModule,"renderContractBody");
    try{await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(body).not.toHaveBeenCalled();expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed"})}));}finally{lock.mockRestore();body.mockRestore();}
  });

  it.each([
    ["material-purchase-real-v1.docx","built-in-legacy-signature-bank-v1",false],
    ["material-purchase-real-v1.docx","built-in-legacy-signature-bank-v1",true],
    ["equipment-rental-real-v1.docx","built-in-legacy-signature-bank-v1",false],
    ["equipment-rental-real-v1.docx","built-in-legacy-mechanical-source-bound-v1",true],
    ["labor-subcontract-real-v1.docx","built-in-labor-signature-legacy-v3",true]
  ])("processes a verified repacked legacy snapshot for %s",async(filename,gate,guarded)=>{
    const original=readFileSync(join(__dirname,"../../assets/templates",filename)),zip=new PizZip(original);zip.comment="synthetic repack";const source=zip.generate({type:"nodebuffer"}),prisma=makePrisma(),job=queuedDocument();
    const positions=layoutMappingApi.readLayoutSourcePositions(source);
    const bindings=positions.positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    const prepared=layoutMappingApi.prepareLayoutSourceMapping(source,"layout-file",2,bindings).mapping,layoutSourceMapping={...prepared,confirmation:{sourceFileId:prepared.sourceFileId,sourceSha256:prepared.sourceSha256,draftRevision:prepared.draftRevision,mappingFingerprint:prepared.fingerprint,previewJobId:"confirmed",previewPdfFileId:"confirmed-pdf"}};
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,layoutSourceMapping,partyDetailsVersion:`${guarded?"built-in-automatic-party-guard-v1:":""}built-in-equivalent-v1:${gate}`,renderInput:{values:{"contract.name":"虚构合同","contract.temporaryCode":"TMP","document.watermark":"草稿","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"}}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});mockedRender.mockImplementation((...args)=>jest.requireActual<typeof import("./contract-docx-renderer")>("./contract-docx-renderer").renderContractDocx(...args));mockedAppendDocxAttachments.mockImplementation((docx:Buffer)=>docx);
    await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();expect(mockedConvert).toHaveBeenCalledTimes(1);expect(files.uploadPrivateFile).toHaveBeenCalled();
  });

  it("normalizes the real generic font declaration for a verified equivalent source",async()=>{
    const original=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),zip=new PizZip(original);zip.comment="synthetic repack";const source=zip.generate({type:"nodebuffer"});
    const prisma=makePrisma(),job=queuedDocument();prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,partyDetailsVersion:"built-in-equivalent-v1:built-in-mapped-generic-legacy-v1",mappedSignatureVersion:"built-in-mapped-signature-supplement-v1",genericFontTableVersion:"built-in-equivalent-generic-font-v1",renderInput:{values:{"party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"}}}});
    const files=generatedDocumentFiles();files.getFileBuffer.mockResolvedValue({file:{id:"layout-file"},buffer:source});mockedRender.mockReturnValue(source);mockedAppendDocxAttachments.mockReturnValue(source);
    await new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never).processNext();
    expect(mockedConvert).toHaveBeenCalledTimes(1);const output=new PizZip(mockedConvert.mock.calls[0][0]);expect(output.file("[Content_Types].xml")!.asText()).toContain('PartName="/word/fontTable.xml"');
  });

  it("does not render a generic-font version with a different source",async()=>{
    const prisma=makePrisma(),job=queuedDocument();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({...job,inputSnapshot:{...job.inputSnapshot,genericFontTableVersion:"built-in-generic-font-v1"}});
    const files=generatedDocumentFiles(),processor=new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never);
    await processor.processNext();
    expect(mockedConvert).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"failed"})}));
  });

  it("claims one queued job atomically and marks it processing", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "queued" },
      data: {
        status: "processing",
        startedAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it.each([
    {
      name: "metadata-only aggregate revision",
      draftRevision: 8,
      currentContent: documentContentCoordinates,
      expectedStatus: "succeeded"
    },
    {
      name: "document content change",
      draftRevision: 7,
      currentContent: {
        documentContentRevision: 3,
        documentContentFingerprint: "b".repeat(64)
      },
      expectedStatus: "stale"
    }
  ])("processes an offline revision after $name", async ({
    draftRevision,
    currentContent,
    expectedStatus
  }) => {
    const prisma = makePrisma();
    prisma.contractOfflineRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "document-source",
      sourceRevision: 7,
      fileId: "revision-docx",
      previewPdfFileId: "previous-preview-pdf",
      label: "第一轮修订稿",
      confirmedByUserId: "owner-1",
      status: "queued",
      createdAt: new Date()
    });
    prisma.contractDocumentComparison.findUnique.mockResolvedValue({
      id: "comparison-1",
      offlineRevisionId: "revision-1",
      status: "queued"
    });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(null);
    prisma.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      clauseSnapshot: [],
      ...documentContentCoordinates
    });
    prisma.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open",
      sourceGeneratedDocumentId: "document-source"
    });
    prisma.tx.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open"
    });
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision,
            ...currentContent,
            status: "draft",
            changeType: "original"
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", voidedAt: null }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    (prisma as unknown as { contractGeneratedDocument: { findUnique: jest.Mock } })
      .contractGeneratedDocument.findUnique = jest.fn().mockResolvedValue({
        id: "document-source",
        contractVersionId: "version-1",
        sourceRevision: 7,
        docxFileId: "source-docx",
        inputSnapshot: queuedDocument().inputSnapshot
      });
    const files = {
      getFileBuffer: jest.fn()
        .mockResolvedValueOnce({ buffer: Buffer.from("revision") })
        .mockResolvedValueOnce({ buffer: Buffer.from("source") }),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "revision-preview-pdf" }),
      linkFileReplacement: jest.fn().mockResolvedValue(undefined),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "processing" },
      data: expect.objectContaining({ status: expectedStatus })
    });
    if (expectedStatus === "succeeded") {
      expect(prisma.tx.contractDocumentDifference.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({
          comparisonId: "comparison-1",
          differenceKey: "difference-key",
          disposition: "pending"
        })]
      });
      expect(prisma.tx.contractDocumentComparison.updateMany).toHaveBeenCalledWith({
        where: { id: "comparison-1", status: "processing" },
        data: expect.objectContaining({
          status: "succeeded",
          algorithmVersion: "contract-docx-patience-v1"
        })
      });
      expect(files.linkFileReplacement).toHaveBeenCalledWith(prisma.tx, {
        newFileId: "revision-preview-pdf",
        oldFileId: "previous-preview-pdf",
        actorUserId: "owner-1"
      });
      expect(audit.record).toHaveBeenCalledWith(
        prisma.tx,
        expect.objectContaining({ action: "contract.offline_revision.process_success" })
      );
    } else {
      expect(prisma.tx.contractDocumentDifference.createMany).not.toHaveBeenCalled();
      expect(files.linkFileReplacement).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        prisma.tx,
        expect.objectContaining({ action: "contract.offline_revision.process_stale" })
      );
    }
  });

  it("fails both the PDF job and comparison closed when an offline DOCX is malformed", async () => {
    const prisma = makePrisma();
    prisma.contractOfflineRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "document-source",
      sourceRevision: 7,
      fileId: "revision-docx",
      label: "坏修订稿",
      confirmedByUserId: "owner-1",
      status: "queued",
      createdAt: new Date()
    });
    prisma.contractDocumentComparison.findUnique.mockResolvedValue({
      id: "comparison-1",
      offlineRevisionId: "revision-1",
      status: "queued"
    });
    prisma.contractVersion.findUnique.mockResolvedValue({ id: "version-1", clauseSnapshot: [] });
    prisma.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open",
      sourceGeneratedDocumentId: "document-source"
    });
    (prisma as unknown as { contractGeneratedDocument: { findUnique: jest.Mock } })
      .contractGeneratedDocument.findUnique = jest.fn().mockResolvedValue({
        id: "document-source",
        contractVersionId: "version-1",
        sourceRevision: 7,
        docxFileId: "source-docx",
        inputSnapshot: queuedDocument().inputSnapshot
      });
    mockedExtract.mockImplementationOnce(() => {
      throw new Error("/tmp/private/bad.docx");
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from("bad") }),
      uploadPrivateFile: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(prisma.tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "processing" },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "线下修订稿解析、比较或 PDF 生成失败，请检查 DOCX 后重试"
      })
    });
    expect(prisma.tx.contractDocumentComparison.updateMany).toHaveBeenCalledWith({
      where: { id: "comparison-1", status: "processing" },
      data: expect.objectContaining({ status: "failed" })
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.offline_revision.process_failure",
        metadata: expect.not.objectContaining({ errorMessage: expect.stringContaining("/tmp") })
      })
    );
  });

  it.each([
    [undefined, undefined],
    ["mechanical-contact-layout-v1", undefined],
    ["mechanical-contact-layout-v2", undefined],
    [undefined, UPLOAD_ORDERED_ATTACHMENTS_VERSION]
  ] as const)("renders and uploads with contact layout %s and attachment order %s", async (contactLayoutVersion, attachmentOrderVersion) => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockResolvedValue([
      {
        draftRevision: 8,
        ...documentContentCoordinates,
        status: "draft"
      }
    ]);
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "negotiation",
      sourceRevision: 8,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        ...(contactLayoutVersion ? {mechanicalContactLayoutVersion:contactLayoutVersion} : {}),
        ...(attachmentOrderVersion ? { attachmentOrderVersion } : {}),
        outputBaseName: "草稿-001-对外磋商稿-修订8",
        renderInput: { values: { "contract.name": "合同" } },
        attachmentFiles: [
          {
            id: "attachment-file",
            originalName: "清单.pdf",
            mimeType: "application/pdf"
          },
          {
            id: "image-file",
            originalName: "营业执照.png",
            mimeType: "image/png"
          }
        ]
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest
        .fn()
        .mockResolvedValueOnce({
          file: { id: "layout-file" },
          buffer: Buffer.from("template")
        })
        .mockResolvedValueOnce({
          file: { id: "attachment-file" },
          buffer: Buffer.from("%PDF-attachment")
        })
        .mockResolvedValueOnce({
          file: { id: "image-file" },
          buffer: Buffer.from("png-attachment")
        }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).toHaveBeenCalledWith(
      Buffer.from("template"),
      { values: { "contract.name": "合同" } },
      [],
      { allowBlankWatermark: false }
    );
    if(contactLayoutVersion) expect(applyMechanicalContactLayout).toHaveBeenCalledWith(Buffer.from("template"),Buffer.from("rendered-docx"),contactLayoutVersion);
    else expect(applyMechanicalContactLayout).not.toHaveBeenCalled();
    const orderedAttachments = [
      { name: "清单.pdf", buffer: Buffer.from("%PDF-attachment"), type: "pdf" },
      { name: "营业执照.png", buffer: Buffer.from("png-attachment"), type: "png" }
    ];
    const bodyDocx = Buffer.from("rendered-docx");
    if (attachmentOrderVersion) {
      expect(mockedAppendDocxAttachments).toHaveBeenCalledWith(bodyDocx, orderedAttachments, { preserveUploadOrder: true });
      expect(mockedConvert).toHaveBeenCalledWith(bodyDocx);
      expect(mockedNormalize).toHaveBeenCalledWith(convertedPdf, orderedAttachments, { preserveUploadOrder: true });
    } else {
      expect(mockedAppendDocxAttachments).toHaveBeenCalledWith(bodyDocx, orderedAttachments);
      expect(mockedConvert).toHaveBeenCalledWith(Buffer.from("docx-with-image-attachments"));
      expect(mockedNormalize).toHaveBeenCalledWith(convertedPdf, orderedAttachments.slice(0, 1));
    }
    expect(files.uploadPrivateFile).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        originalName: "草稿-001-对外磋商稿-修订8.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        uploadedByUserId: "owner-1",
        buffer: Buffer.from("docx-with-image-attachments"),
        sizeBytes: Buffer.from("docx-with-image-attachments").length
      })
    );
    expect(files.uploadPrivateFile).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        originalName: "草稿-001-对外磋商稿-修订8.pdf",
        mimeType: "application/pdf",
        uploadedByUserId: "owner-1"
      })
    );
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 8
      },
      data: expect.objectContaining({
        status: "success",
        docxFileId: "docx-file",
        pdfFileId: "pdf-file",
        completedAt: expect.any(Date),
        engineVersion: "contract-document-v1",
        inputSnapshot: expect.objectContaining({
          inspection: {
            pageCount: 2,
            pageSizes: ["A4_portrait", "A4_landscape"],
            warnings: []
          }
        })
      })
    });
    expect(prisma.tx.contractGeneratedDocument.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: "document-1" },
        contractVersionId: "version-1",
        purpose: "negotiation",
        status: { in: ["success", "stale"] },
        docxFileId: { not: null },
        pdfFileId: { not: null }
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" }
      ],
      select: {
        id: true,
        sourceRevision: true,
        status: true,
        docxFileId: true,
        pdfFileId: true
      }
    });
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.success",
        metadata: expect.objectContaining({
          docxFileId: "docx-file",
          pdfFileId: "pdf-file",
          pageCount: 2,
          predecessorDocumentId: null,
          docxOldFileId: null,
          docxNewFileId: "docx-file",
          pdfOldFileId: null,
          pdfNewFileId: "pdf-file",
          replacementKind: null
        })
      })
    );
  });

  it("renders an external document without a watermark and binds the generated files", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({
        purpose: "external",
        inputSnapshot: {
          ...documentContentCoordinates,
          templateFileId: "layout-file",
          outputBaseName: "HT-20260806-007-外发合同-修订3",
          renderInput: {
            values: {
              "contract.name": "钢材采购合同",
              "contract.code": "HT-20260806-007"
            }
          },
          requiredKeys: [],
          attachmentFiles: []
        }
      })
    );
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).toHaveBeenCalledWith(
      Buffer.from("template"),
      {
        values: {
          "contract.name": "钢材采购合同",
          "contract.code": "HT-20260806-007"
        }
      },
      [],
      { allowBlankWatermark: true }
    );
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "document-1", status: "processing", sourceRevision: 3 },
      data: expect.objectContaining({
        status: "success",
        docxFileId: "docx-file",
        pdfFileId: "pdf-file"
      })
    });
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalled();
  });

  it("marks a failed external generation without binding any file", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({
        purpose: "external",
        inputSnapshot: {
          ...documentContentCoordinates,
          templateFileId: "layout-file",
          outputBaseName: "HT-20260806-007-外发合同-修订3",
          renderInput: { values: {} },
          requiredKeys: [],
          attachmentFiles: []
        }
      })
    );
    mockedRender.mockImplementation(() => {
      throw new Error("合同 DOCX 模板渲染失败，请检查模板内容");
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest.fn(),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "document-1", status: "processing", sourceRevision: 3 },
      data: {
        status: "failed",
        errorMessage: "合同 DOCX 模板渲染失败，请检查模板内容",
        completedAt: expect.any(Date)
      }
    });
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalledWith(
      [],
      "owner-1"
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        businessId: "document-1",
        metadata: expect.objectContaining({ orphanFileIds: [] })
      })
    );
  });

  it.each(["success", "stale"])(
    "links DOCX then PDF to the nearest %s predecessor after the success CAS",
    async (predecessorStatus) => {
      const prisma = makePrisma();
      prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
        queuedDocument({ purpose: "negotiation" })
      );
      prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
        id: "document-predecessor",
        sourceRevision: 2,
        status: predecessorStatus,
        docxFileId: "docx-file-old",
        pdfFileId: "pdf-file-old"
      });
      const files = generatedDocumentFiles();
      const processor = new ContractDocumentProcessor(
        prisma as unknown as PrismaService,
        files as never,
        audit as never
      );

      await processor.processNext();

      expect(files.linkFileReplacement).toHaveBeenNthCalledWith(1, prisma.tx, {
        newFileId: "docx-file",
        oldFileId: "docx-file-old",
        actorUserId: "owner-1"
      });
      expect(files.linkFileReplacement).toHaveBeenNthCalledWith(2, prisma.tx, {
        newFileId: "pdf-file",
        oldFileId: "pdf-file-old",
        actorUserId: "owner-1"
      });
      expect(
        prisma.tx.contractGeneratedDocument.updateMany.mock.invocationCallOrder[0]
      ).toBeLessThan(
        prisma.tx.contractGeneratedDocument.findFirst.mock.invocationCallOrder[0]
      );
      expect(
        prisma.tx.contractGeneratedDocument.findFirst.mock.invocationCallOrder[0]
      ).toBeLessThan(files.linkFileReplacement.mock.invocationCallOrder[0]);
      expect(files.linkFileReplacement.mock.invocationCallOrder[0]).toBeLessThan(
        files.linkFileReplacement.mock.invocationCallOrder[1]
      );
      expect(files.linkFileReplacement.mock.invocationCallOrder[1]).toBeLessThan(
        audit.record.mock.invocationCallOrder[0]
      );
      expect(audit.record).toHaveBeenCalledWith(
        prisma.tx,
        expect.objectContaining({
          action: "contract.document.success",
          metadata: expect.objectContaining({
            docxFileId: "docx-file",
            pdfFileId: "pdf-file",
            pageCount: 2,
            predecessorDocumentId: "document-predecessor",
            docxOldFileId: "docx-file-old",
            docxNewFileId: "docx-file",
            pdfOldFileId: "pdf-file-old",
            pdfNewFileId: "pdf-file",
            replacementKind: "contract_generated_document_revision"
          })
        })
      );
    }
  );

  it("publishes a complete draft preview atomically before superseding and discarding the previous preview", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "draft", sourceRevision: 3 })
    );
    prisma.tx.$queryRaw.mockResolvedValue([
      {
        draftRevision: 3,
        ...documentContentCoordinates,
        status: "draft",
        changeType: null,
        draftData: {},
        latestDraftPreviewDocumentId: "document-previous"
      }
    ]);
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-previous",
      sourceRevision: 2,
      status: "success",
      docxFileId: "docx-file-old",
      pdfFileId: "pdf-file-old"
    });
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        ...documentContentCoordinates,
        latestDraftPreviewDocumentId: "document-previous"
      },
      data: { latestDraftPreviewDocumentId: "document-1" }
    });
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-previous",
        status: "success",
        docxFileId: "docx-file-old",
        pdfFileId: "pdf-file-old"
      },
      data: {
        status: "superseded",
        docxFileId: null,
        pdfFileId: null
      }
    });
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalledWith(
      ["docx-file-old", "pdf-file-old"],
      "owner-1"
    );
  });

  it("uploads neither generated format and keeps the previous preview when PDF conversion fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "draft", sourceRevision: 3 })
    );
    prisma.tx.$queryRaw.mockResolvedValue([
      {
        draftRevision: 3,
        status: "draft",
        changeType: null,
        draftData: {},
        latestDraftPreviewDocumentId: "document-previous"
      }
    ]);
    mockedConvert.mockRejectedValueOnce(new Error("PDF conversion failed"));
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest.fn().mockResolvedValueOnce({ id: "docx-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.uploadPrivateFile).toHaveBeenCalledTimes(0);
    expect(files.discardUnlinkedGeneratedFiles).toHaveBeenCalledWith([], "owner-1");
    expect(audit.record).toHaveBeenCalledWith(prisma.tx, expect.objectContaining({
      action: "contract.document.failure", metadata: expect.objectContaining({ orphanFileIds: [] })
    }));
    expect(prisma.tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(prisma.tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "document-previous" })
      })
    );
  });

  it("records failure and skips PDF linking when DOCX replacement linking fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "negotiation" })
    );
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-predecessor",
      sourceRevision: 2,
      docxFileId: "docx-file-old",
      pdfFileId: "pdf-file-old"
    });
    const files = generatedDocumentFiles();
    files.linkFileReplacement.mockRejectedValueOnce(new Error("DOCX link failed"));
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.linkFileReplacement).toHaveBeenCalledTimes(1);
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it("records both uploaded files as orphans when PDF replacement linking fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "negotiation" })
    );
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-predecessor",
      sourceRevision: 2,
      docxFileId: "docx-file-old",
      pdfFileId: "pdf-file-old"
    });
    const files = generatedDocumentFiles();
    files.linkFileReplacement
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("PDF link failed"));
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.linkFileReplacement).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it("rolls back terminal success and records failure when success audit fails", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument({ purpose: "negotiation" })
    );
    const files = generatedDocumentFiles();
    audit.record
      .mockRejectedValueOnce(new Error("success audit failed"))
      .mockResolvedValueOnce(undefined);
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(audit.record).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenNthCalledWith(
      2,
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it.each([
    { id: "", docxFileId: "docx-file-old", pdfFileId: "pdf-file-old" },
    { id: "document-predecessor", docxFileId: " ", pdfFileId: "pdf-file-old" },
    { id: "document-predecessor", docxFileId: "docx-file-old", pdfFileId: null }
  ])("fails safely when the predecessor file ids are malformed", async (predecessor) => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    prisma.tx.contractGeneratedDocument.findFirst.mockResolvedValue({
      sourceRevision: 2,
      ...predecessor
    });
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({
          orphanFileIds: ["docx-file", "pdf-file"]
        })
      })
    );
  });

  it("renders a queued layout preview before a queued contract document and attaches its PDF", async () => {
    const converted = await PDFDocument.create();
    converted.addPage([595.28, 841.89]);
    mockedConvert.mockResolvedValueOnce(Buffer.from(await converted.save()));
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: { contract: { name: "预览合同" } },
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      status: "queued"
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "layout-file",
      placeholderSchema: {},
      inspectionReport: {}
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: previewWordSource()
      }),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "preview-pdf" })
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(mockedRender).toHaveBeenCalledWith(
      previewWordSource(),
      expect.objectContaining({
        values: expect.objectContaining({
          "contract.name": "预览合同",
          "contract.temporaryCode": "预览",
          "document.watermark": "预览"
        })
      }),
      expect.arrayContaining([
        "contract.name",
        "contract.temporaryCode",
        "document.watermark"
      ])
    );
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: {
        status: "succeeded",
        previewPdfFileId: "preview-pdf",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
  });

  it("marks a preview stale when its source revision no longer matches the draft", async () => {
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: {},
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 3,
      docxFileId: "layout-file",
      placeholderSchema: {},
      inspectionReport: {}
    });
    const files = { getFileBuffer: jest.fn(), uploadPrivateFile: jest.fn() };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: { status: "stale", completedAt: expect.any(Date), errorMessage: null }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not attach an uploaded preview when the draft changes during rendering", async () => {
    const converted = await PDFDocument.create();
    converted.addPage([595.28, 841.89]);
    mockedConvert.mockResolvedValueOnce(Buffer.from(await converted.save()));
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: {},
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "layout-file",
      placeholderSchema: {},
      inspectionReport: {}
    });
    prisma.tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 3
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: previewWordSource() }),
      uploadPrivateFile: jest.fn().mockResolvedValue({ id: "orphan-preview-pdf" })
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(files.uploadPrivateFile).toHaveBeenCalled();
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: { status: "stale", completedAt: expect.any(Date), errorMessage: null }
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown Chinese error", () => new Error("合同第三方存储失败：/tmp/secret.docx")],
    [
      "throwing string conversion",
      () => ({
        toString() {
          throw new Error("TOP-SECRET toString");
        }
      })
    ],
    [
      "throwing Error.message getter",
      () => {
        const cause = new Error();
        Object.defineProperty(cause, "message", {
          get() {
            throw new Error("TOP-SECRET message getter");
          }
        });
        return cause;
      }
    ]
  ])("marks failure safely for %s and records possible orphan uploads", async (_case, cause) => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 2,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订2",
        renderInput: { values: {} },
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "orphan-docx" })
        .mockRejectedValueOnce(cause()),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    const failure = prisma.tx.contractGeneratedDocument.updateMany.mock.calls[0][0];
    expect(failure.where).toEqual({
      id: "document-1",
      status: "processing",
      sourceRevision: 2
    });
    expect(failure.data.status).toBe("failed");
    expect(failure.data.errorMessage).toBe("合同文档生成失败，请检查模板和附件后重试");
    expect(failure.data.errorMessage).not.toContain("orphan-docx");
    expect(failure.data.errorMessage).not.toContain("/tmp/secret.docx");
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.failure",
        metadata: expect.objectContaining({ orphanFileIds: ["orphan-docx"] })
      })
    );
  });

  it("observes the exact failed worker stage without changing persisted failure", async () => {
    const prisma=makePrisma(),generationId="10000000-0000-4000-8000-000000000002",versionId="10000000-0000-4000-8000-000000000001";
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({id:generationId,contractVersionId:versionId,status:"queued",purpose:"draft",sourceRevision:2,inputSnapshot:{...documentContentCoordinates,templateFileId:"layout-file",outputBaseName:"虚构",renderInput:{values:{}},requiredKeys:[],attachmentFiles:[]},createdByUserId:"owner-1",createdAt:new Date()});
    const files={getFileBuffer:jest.fn().mockRejectedValue(new Error("PRIVATE_TEMPLATE")),discardUnlinkedGeneratedFiles:jest.fn().mockResolvedValue(undefined)};
    const processor=new ContractDocumentProcessor(prisma as unknown as PrismaService,files as never,audit as never), token=armCon18WorkerDiagnostic(processor);
    try {await processor.processNext();const result=takeCon18WorkerDiagnostic(processor,token,{generationId,versionId,sourceRevision:2,...documentContentCoordinates});expect(result).toEqual({status:"OBSERVED",stage:"TEMPLATE",errorKind:"ERROR"});expect(JSON.stringify(result)).not.toMatch(/PRIVATE|10000000/u);expect(prisma.tx.contractGeneratedDocument.updateMany.mock.calls[0][0].data.status).toBe("failed");}
    finally {closeCon18WorkerDiagnostic(processor,token);}
  });

  it("reports the rejected predecessor lookup inside a scoped publication failure", async () => {
    const prisma = makePrisma();
    const generationId = "10000000-0000-4000-8000-000000000002";
    const versionId = "10000000-0000-4000-8000-000000000001";
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument({ id: generationId, contractVersionId: versionId }));
    prisma.tx.contractGeneratedDocument.findFirst.mockRejectedValueOnce(new Error("PRIVATE_PUBLISH"));
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(prisma as unknown as PrismaService, files as never, audit as never);
    const token = armCon18WorkerDiagnostic(processor);
    try {
      await processor.processNext();
      const detail = takeCon18WorkerDiagnostic(processor, token, { generationId, versionId, sourceRevision: 3, ...documentContentCoordinates });
      expect(detail).toMatchObject({ status: "OBSERVED", stage: "PUBLISH", errorKind: "ERROR", publishPhase: "PREDECESSOR_READ", publishElapsedMs: expect.any(Number) });
      expect(JSON.stringify(detail)).not.toMatch(/PRIVATE|10000000/u);
      expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }));
    } finally {
      closeCon18WorkerDiagnostic(processor, token);
    }
  });

  it("requeues expired processing leases before claiming work", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: "processing",
        startedAt: { lt: expect.any(Date) }
      },
      data: {
        status: "queued",
        startedAt: null,
        completedAt: null,
        errorMessage: null
      }
    });
  });

  it("publishes a document when only the aggregate draft revision changed", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 4,
            ...documentContentCoordinates,
            status: "draft",
            changeType: "original",
            draftData: {},
            latestDraftPreviewDocumentId: null
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "success" }) })
    );
    expect(prisma.tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        documentContentRevision: 2,
        documentContentFingerprint,
        latestDraftPreviewDocumentId: null
      },
      data: { latestDraftPreviewDocumentId: "document-1" }
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.document.success",
        metadata: expect.objectContaining(documentContentCoordinates)
      })
    );
  });

  it("marks a document stale when its frozen content revision changes", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 3,
            documentContentRevision: 3,
            documentContentFingerprint: "b".repeat(64),
            status: "draft",
            changeType: "original",
            draftData: {}
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", ownerUserId: "owner-1", voidedAt: null }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: { id: "document-1", status: "processing", sourceRevision: 3 },
      data: { status: "stale", completedAt: expect.any(Date), errorMessage: null }
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
  });

  it.each([
    ["formal business evidence", false, true],
    ["an exact historical takeover relation", true, false]
  ])("marks a generated document stale when the locked draft has %s", async (
    _case,
    hasHistoricalTakeoverRelation,
    hasSignedFormalFile
  ) => {
    const prisma = makePrisma();
    const terminalQueries: string[] = [];
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        terminalQueries.push(sql);
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 3,
            ...documentContentCoordinates,
            status: "draft",
            changeType: "original",
            hasHistoricalTakeoverRelation,
            draftData: {}
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{
            id: "contract-1",
            ownerUserId: "owner-1",
            voidedAt: null
          }];
        }
        return [{
          hasSignedFormalFile,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(
      queuedDocument()
    );
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(terminalQueries[0]).toContain("FOR UPDATE OF c");
    expect(terminalQueries[1]).toContain("FOR UPDATE OF cv");
    expect(terminalQueries[2]).toContain('"ContractFormalFile"');
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 3
      },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(prisma.tx.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("stales an offline comparison for a relation-only historical takeover", async () => {
    const prisma = makePrisma();
    prisma.contractOfflineRevision.findFirst.mockResolvedValue({
      id: "revision-1",
      contractVersionId: "version-1",
      negotiationRoundId: "round-1",
      sourceGeneratedDocumentId: "document-source",
      sourceRevision: 7,
      fileId: "revision-docx",
      previewPdfFileId: null,
      label: "第一轮修订稿",
      confirmedByUserId: "owner-1",
      status: "queued",
      createdAt: new Date()
    });
    prisma.contractDocumentComparison.findUnique.mockResolvedValue({
      id: "comparison-1",
      offlineRevisionId: "revision-1",
      status: "queued"
    });
    prisma.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      clauseSnapshot: [],
      templateSnapshot: {}
    });
    prisma.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open",
      sourceGeneratedDocumentId: "document-source"
    });
    prisma.tx.contractNegotiationRound.findUnique.mockResolvedValue({
      id: "round-1",
      status: "open"
    });
    (prisma as unknown as {
      contractGeneratedDocument: { findUnique: jest.Mock };
    }).contractGeneratedDocument.findUnique = jest.fn().mockResolvedValue({
      id: "document-source",
      contractVersionId: "version-1",
      sourceRevision: 7,
      docxFileId: "source-docx",
      inputSnapshot: queuedDocument().inputSnapshot
    });
    const terminalQueries: string[] = [];
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        terminalQueries.push(sql);
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 7,
            ...documentContentCoordinates,
            status: "draft",
            changeType: "original",
            hasHistoricalTakeoverRelation: true,
            draftData: {},
            clauseSnapshot: [],
            templateSnapshot: {}
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", voidedAt: null }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    const files = {
      getFileBuffer: jest.fn()
        .mockResolvedValueOnce({ buffer: Buffer.from("revision") })
        .mockResolvedValueOnce({ buffer: Buffer.from("source") }),
      uploadPrivateFile: jest.fn().mockResolvedValue({
        id: "revision-preview-pdf"
      }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(terminalQueries[0]).toContain("FOR UPDATE OF c");
    expect(terminalQueries[1]).toContain("FOR UPDATE OF cv");
    expect(prisma.tx.contractDocumentDifference.deleteMany).not.toHaveBeenCalled();
    expect(prisma.tx.contractOfflineRevision.updateMany).toHaveBeenCalledWith({
      where: { id: "revision-1", status: "processing" },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(prisma.tx.contractDocumentComparison.updateMany).toHaveBeenCalledWith({
      where: { id: "comparison-1", status: "processing" },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({
        action: "contract.offline_revision.process_stale"
      })
    );
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("marks a document stale when the selected company version drifts before terminal success", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockImplementation(
      async (query: { strings?: string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            draftRevision: 3,
            ...documentContentCoordinates,
            status: "draft",
            changeType: "original",
            draftData: {
              companyEntitySelection: { id: "company-1", versionNo: 1 }
            }
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", voidedAt: null }];
        }
        if (sql.includes('"CompanyEntity"')) {
          return [{ id: "company-1" }];
        }
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: false,
          hasPaymentRequest: false
        }];
      }
    );
    prisma.tx.companyEntity.findUnique.mockResolvedValue({
      id: "company-1",
      isActive: true,
      dataStatus: "complete",
      currentVersionNo: 2
    });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    const files = generatedDocumentFiles();
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: "document-1",
        status: "processing",
        sourceRevision: 3
      },
      data: {
        status: "stale",
        completedAt: expect.any(Date),
        errorMessage: null
      }
    });
    expect(audit.record).not.toHaveBeenCalledWith(
      prisma.tx,
      expect.objectContaining({ action: "contract.document.success" })
    );
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("does not audit terminal success or failure when its CAS loses", async () => {
    const prisma = makePrisma();
    prisma.tx.$queryRaw.mockResolvedValue([
      {
        draftRevision: 3,
        ...documentContentCoordinates,
        status: "draft"
      }
    ]);
    prisma.tx.contractGeneratedDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockResolvedValue({
        file: { id: "layout-file" },
        buffer: Buffer.from("template")
      }),
      uploadPrivateFile: jest
        .fn()
        .mockResolvedValueOnce({ id: "docx-file" })
        .mockResolvedValueOnce({ id: "pdf-file" }),
      linkFileReplacement: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "success" }) })
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(prisma.tx.contractGeneratedDocument.findFirst).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
  });

  it("does not audit a failure when its processing CAS loses", async () => {
    const prisma = makePrisma();
    prisma.tx.contractGeneratedDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "queued",
      purpose: "draft",
      sourceRevision: 3,
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file",
        outputBaseName: "草稿-001-草稿-修订3",
        renderInput: { values: {} },
        requiredKeys: [],
        attachmentFiles: []
      },
      createdByUserId: "owner-1",
      createdAt: new Date()
    });
    const files = {
      getFileBuffer: jest.fn().mockRejectedValue(new Error("render failed")),
      uploadPrivateFile: jest.fn(),
      discardUnlinkedGeneratedFiles: jest.fn().mockResolvedValue(undefined)
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects preview bill placeholders whose sample values are not arrays", async () => {
    const prisma = makePrisma();
    prisma.contractLayoutPreviewJob.findFirst.mockResolvedValue({
      id: "preview-1",
      layoutTemplateVersionId: "layout-1",
      status: "queued",
      sourceRevision: 2,
      sampleData: { values: { "bill.materials": "not-an-array" } },
      createdByUserId: "staff-1",
      createdAt: new Date()
    });
    prisma.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      status: "draft",
      draftRevision: 2,
      docxFileId: "layout-file",
      placeholderSchema: { bills: [{ key: "materials" }] },
      inspectionReport: { placeholders: ["bill.materials"] }
    });
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await processor.processNext();

    expect(mockedRender).not.toHaveBeenCalled();
    expect(prisma.tx.contractLayoutPreviewJob.updateMany).toHaveBeenCalledWith({
      where: { id: "preview-1", status: "processing", sourceRevision: 2 },
      data: {
        status: "failed",
        errorMessage: "合同版式预览清单数据格式不正确",
        completedAt: expect.any(Date)
      }
    });
  });

  it("does not produce duplicate files when a completed job is polled again", async () => {
    const prisma = makePrisma();
    const documents = [
      {
        id: "document-1",
        status: "success",
        docxFileId: "docx-file",
        pdfFileId: "pdf-file",
        completedAt: new Date()
      }
    ];
    prisma.contractGeneratedDocument.findFirst.mockImplementation(
      ({ where }: { where: { status: string } }) =>
        Promise.resolve(
          documents.find((document) => document.status === where.status) ?? null
        )
    );
    const files = {
      getFileBuffer: jest.fn(),
      uploadPrivateFile: jest.fn()
    };
    const processor = new ContractDocumentProcessor(
      prisma as unknown as PrismaService,
      files as never,
      audit as never
    );

    await expect(processor.processNext()).resolves.toBe(false);
    await expect(processor.processNext()).resolves.toBe(false);

    expect(prisma.contractGeneratedDocument.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.contractGeneratedDocument.findFirst).toHaveBeenCalledWith({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" }
    });
    expect(mockedRender).not.toHaveBeenCalled();
    expect(mockedConvert).not.toHaveBeenCalled();
    expect(mockedNormalize).not.toHaveBeenCalled();
    expect(files.getFileBuffer).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
    expect(prisma.contractGeneratedDocument.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });
  it("drains a claimed document through file publication and audit before shutdown returns", async () => {
    const prisma = makePrisma();
    prisma.contractGeneratedDocument.findFirst.mockResolvedValue(queuedDocument());
    const files = generatedDocumentFiles();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    files.getFileBuffer.mockImplementationOnce(async () => {
      entered();await blocked;
      return { file: { id: "layout-file" }, buffer: Buffer.from("template") };
    });
    const processor = new ContractDocumentProcessor(prisma as unknown as PrismaService, files as never, audit as never);
    const work = processor.processNext();await started;
    let stopped = false;
    const shutdown = processor.onModuleDestroy().then(() => { stopped = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const returnedBeforeRelease = stopped;
    release();await work;await shutdown;
    expect(returnedBeforeRelease).toBe(false);
    expect(prisma.tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "success" }) }));
    expect(audit.record).toHaveBeenCalledWith(prisma.tx, expect.objectContaining({ action: "contract.document.success" }));
    await expect(processor.processNext()).resolves.toBe(false);
    await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
  });

});

describe("ContractDocumentProcessor operational freeze", () => {
  const previousMode = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
  const previousModules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
  afterEach(() => {
    if (previousMode === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    else process.env.OPERATIONAL_WRITE_FREEZE_MODE = previousMode;
    if (previousModules === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    else process.env.OPERATIONAL_WRITE_FREEZE_MODULES = previousModules;
  });

  it("does not reach database recovery or file writes under an all freeze", async () => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "all";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = "";
    const boundary = new Proxy({}, { get() { throw new Error("frozen worker reached a dependency"); } });
    const processor = new ContractDocumentProcessor(
      boundary as PrismaService, boundary as never, boundary as never
    );
    await expect(processor.processNext()).resolves.toBe(false);
  });
});

describe("ContractDocumentProcessor freeze configuration", () => {
  const previousMode = process.env.OPERATIONAL_WRITE_FREEZE_MODE;
  const previousModules = process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
  afterEach(() => {
    if (previousMode === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODE;
    else process.env.OPERATIONAL_WRITE_FREEZE_MODE = previousMode;
    if (previousModules === undefined) delete process.env.OPERATIONAL_WRITE_FREEZE_MODULES;
    else process.env.OPERATIONAL_WRITE_FREEZE_MODULES = previousModules;
  });
  const processor = () => {
    const boundary = new Proxy({}, { get() { throw new Error("worker dependency reached"); } });
    return new ContractDocumentProcessor(boundary as PrismaService, boundary as never, boundary as never);
  };
  it.each(["contract", "files"])("pauses before dependencies when %s is frozen", async (module) => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = module;
    await expect(processor().processNext()).resolves.toBe(false);
  });
  it.each(["off", "unrelated-module"])("preserves ordinary worker access for %s", async (mode) => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = mode === "off" ? "off" : "modules";
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = mode === "off" ? "" : "payment";
    await expect(processor().processNext()).rejects.toThrow("worker dependency reached");
  });
  it.each([["unknown", ""], ["modules", "unknown"]])("invalid mode/modules %s/%s fail closed", async (mode, modules) => {
    process.env.OPERATIONAL_WRITE_FREEZE_MODE = mode;
    process.env.OPERATIONAL_WRITE_FREEZE_MODULES = modules;
    await expect(processor().processNext()).rejects.toMatchObject({
      response: { code: "OPERATIONAL_WRITE_FREEZE_CONFIGURATION_INVALID" }
    });
  });
});

describe("ContractDocumentProcessor shutdown drain", () => {
  it("waits for an in-flight recovery and never claims a new job after shutdown", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let claims = 0;
    const first = { updateMany: async () => { entered(); await blocked; return { count: 0 }; }, findFirst: async () => { claims++; return null; } };
    const later = { updateMany: async () => ({ count: 0 }), findFirst: async () => { claims++; return null; } };
    const prisma = { contractLayoutPreviewJob: first, contractGeneratedDocument: later, contractOfflineRevision: later, contractDocumentComparison: later };
    const processor = new ContractDocumentProcessor(prisma as unknown as PrismaService, {} as never, {} as never);
    const work = processor.processNext();await started;
    let stopped = false;
    const shutdown = Promise.resolve(processor.onApplicationShutdown()).then(() => { stopped = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const returnedBeforeRelease = stopped;
    release();await work;await shutdown;
    expect(returnedBeforeRelease).toBe(false);
    expect(claims).toBe(0);
    await expect(processor.processNext()).resolves.toBe(false);
  });
});

describe("ContractDocumentProcessor failed-work drain", () => {
  it("settles shutdown after in-flight failure while preserving the caller's error", async () => {
    let fail!: (error: Error) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((_resolve, reject) => { fail = reject; });
    const prisma = { contractLayoutPreviewJob: { updateMany: async () => { entered(); await blocked; } } };
    const processor = new ContractDocumentProcessor(prisma as unknown as PrismaService, {} as never, {} as never);
    const work = processor.processNext().catch((error: unknown) => error);await started;
    const shutdown = processor.onModuleDestroy();
    const fault = new Error("local fixture work failure");fail(fault);
    expect(await work).toBe(fault);
    await expect(shutdown).resolves.toBeUndefined();
    await expect(processor.processNext()).resolves.toBe(false);
    await expect(processor.onApplicationShutdown()).resolves.toBeUndefined();
  });
});

describe("ContractDocumentProcessor lookup/shutdown race", () => {
  it.each(["contractLayoutPreviewJob", "contractOfflineRevision", "contractGeneratedDocument"])("does not claim %s when lookup returns after shutdown", async (target) => {
    let release!: (job: Record<string, unknown>) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const lookup = new Promise<Record<string, unknown>>((resolve) => { release = resolve; });
    const model = () => ({
      updateMany: async (args: { where?: { id?: string } }) => {
        if (args.where?.id === "late-job") throw new Error("late claim crossed shutdown boundary");
        return { count: 0 };
      },
      findFirst: async (): Promise<Record<string, unknown> | null> => null,
      findUnique: async () => ({ id: "comparison", status: "queued" })
    });
    const tables = { contractLayoutPreviewJob: model(), contractOfflineRevision: model(), contractGeneratedDocument: model(), contractDocumentComparison: model() };
    tables[target as keyof typeof tables].findFirst = async () => { entered(); return lookup; };
    const prisma = { ...tables, $transaction: async (callback: (tx: typeof tables) => Promise<unknown>) => callback(tables) };
    const processor = new ContractDocumentProcessor(prisma as unknown as PrismaService, {} as never, {} as never);
    const work = processor.processNext().then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    await started;const shutdown = processor.onModuleDestroy();
    release({ id: "late-job", status: "queued" });
    expect(await work).toEqual({ value: false, error: undefined });
    await expect(shutdown).resolves.toBeUndefined();
  });
});

describe("ContractDocumentProcessor comparison/transaction shutdown race", () => {
  it.each(["comparison", "transaction"])("does not claim after shutdown while awaiting %s", async (phase) => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const model = () => ({
      updateMany: async (args: { where?: { id?: string } }) => {
        if (args.where?.id === "late-job") throw new Error("late offline claim crossed shutdown boundary");
        return { count: 0 };
      }, findFirst: async (): Promise<Record<string, unknown> | null> => null
    });
    const tables = { contractLayoutPreviewJob: model(), contractGeneratedDocument: model(), contractOfflineRevision: model(), contractDocumentComparison: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => { if (phase === "comparison") { entered(); await blocked; } return { id: "comparison", status: "queued" }; }
    } };
    tables.contractOfflineRevision.findFirst = async () => ({ id: "late-job", status: "queued" });
    const prisma = { ...tables, $transaction: async (callback: (tx: typeof tables) => Promise<unknown>) => {
      if (phase === "transaction") { entered(); await blocked; }
      return callback(tables);
    } };
    const processor = new ContractDocumentProcessor(prisma as unknown as PrismaService, {} as never, {} as never);
    const work = processor.processNext().then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    await started;const shutdown = processor.onModuleDestroy();release();
    expect(await work).toEqual({ value: false, error: undefined });
    await expect(shutdown).resolves.toBeUndefined();
  });
});
