import { unicodePathOverride } from "./builtin-template-parts.test-support";
import PizZip from "pizzip";
import { renderContractBody } from "./contract-body-document";
import { syntheticWordSource } from "../contract-template/template-management.test-support";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { FileService, type PrivateFileStorage } from "../file/file.service";
import { ContractDocumentService, requiredPlaceholderKeys } from "./contract-document.service";

describe("ContractDocumentService", () => {
  const documentContentFingerprint = "a".repeat(64);
  const documentContentCoordinates = {
    documentContentRevision: 3,
    documentContentFingerprint
  };
  // A valid confirmed source is this service fixture's selection precondition;
  // actual manual confirmation and file conversion are covered through HTTP.
  const source = syntheticWordSource();
  const parsed = readLayoutSourcePositions(source);
  const keys = ["contract.name", "party.owner.name", "party.counterparty.name", "contract.temporaryCode", "document.watermark"];
  const { mapping } = prepareLayoutSourceMapping(source, "layout-file-1", 2, parsed.positions.slice(0, 5).map((position, index) => ({ positionId: position.positionId, start: index === 0 ? 5 : index === 4 ? 0 : 3, end: position.text.length, fieldKey: keys[index] })));
  const sourceMapping = { ...mapping, confirmation: { sourceFileId: mapping.sourceFileId, sourceSha256: mapping.sourceSha256, draftRevision: 2, mappingFingerprint: mapping.fingerprint, previewJobId: "confirmed-preview", previewPdfFileId: "confirmed-pdf" } };
  const audit = { record: jest.fn() };
  const makeFiles = () => ({
    getFileBuffer: jest.fn().mockResolvedValue({ buffer: source, file: { id: "layout-file-1", storageStatus: "active", contentSha256: createHash("sha256").update(source).digest("hex") } }),
    assertCanDownloadFile: jest.fn(),
    linkFileReplacement: jest.fn()
  });
  let files: ReturnType<typeof makeFiles>;
  const docxMime =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  beforeEach(() => {
    files = makeFiles();
    audit.record.mockReset();
    files.linkFileReplacement.mockReset().mockResolvedValue(undefined);
    files.assertCanDownloadFile.mockReset().mockImplementation(
      (_tx, id: string) =>
        Promise.resolve({
          id,
          originalName: id.startsWith("revision-file")
            ? "线下修订稿.docx"
            : id === "attachment-a"
              ? "附件A.pdf"
              : "附件B.png",
          mimeType: id.startsWith("revision-file")
            ? docxMime
            : id === "attachment-a"
              ? "application/pdf"
              : "image/png"
        })
    );
  });

  it("does not require bill loop columns as top-level render values", () => {
    const keys = requiredPlaceholderKeys({
      fields: [{ key: "deliveryLocation", required: true }],
      bills: [
        {
          key: "materials",
          columns: [{ key: "itemName", required: true }]
        }
      ]
    });

    expect(keys).toContain("field.deliveryLocation");
    expect(keys).not.toContain("itemName");
  });

  function makeTx(overrides: Record<string, unknown> = {}) {
    return {
      $queryRaw: jest.fn(async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1"
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1", contractId: "contract-1" }];
        }
        if (sql.includes('AS "hasSignedFormalFile"')) {
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
        if (sql.includes('FROM "CompanyEntity"')) {
          return [{ id: "entity-1" }];
        }
        return [];
      }),
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
          layoutTemplateVersionId: "layout-1",
          amountCents: 1_000_000n,
          invoiceType: "vat_special",
          defaultTaxRatePercent: { toString: () => "13" },
          draftData: { projectName: "建设项目一期", deliveryLocation: "项目现场", deliveryDate: "2026-11-12" },
          clauseSnapshot: [
            { key: "payment", content: { text: "结算后付款" } }
          ],
          readinessSnapshot: {
            checkedRevision: 7,
            checkedDocumentContentRevision: 3,
            checkedDocumentContentFingerprint: documentContentFingerprint,
            blocking: [],
            warnings: []
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          name: "钢材采购合同",
          contractTypeKey: "materials",
          temporaryCode: "草稿-001",
          code: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractNumberTombstone: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "company-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 1
        })
      },
      contractLayoutTemplateVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-1",
          layoutTemplateId: "layout-template-1",
          status: "published",
          docxFileId: "layout-file-1",
          draftRevision: 2,
          placeholderSchema: {
            sourceMapping,
            required: ["field.deliveryLocation"],
            fields: [{ key: "deliveryDate", required: true }],
            bills: []
          },
          inspectionReport: { placeholders: ["field.deliveryLocation"] }
        })
      },
      contractLayoutTemplate: {
        findUnique: jest.fn().mockResolvedValue({
          id: "layout-template-1",
          contractTypeKey: "materials"
        })
      },
      contractPartySnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            roleKey: "party_a",
            displayOrder: 0,
            snapshot: { name: "建工智管建设有限公司" }
          },
          {
            roleKey: "party_b",
            displayOrder: 1,
            snapshot: { name: "示例供应商" }
          }
        ])
      },
      contractBill: { findMany: jest.fn().mockResolvedValue([]) },
      contractBillRow: { findMany: jest.fn().mockResolvedValue([]) },
      contractDraftAttachment: {
        findMany: jest.fn().mockResolvedValue([
          { fileId: "attachment-a" }
        ])
      },
      contractGeneratedDocument: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "document-1",
          ...data
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn()
      },
      contractOfflineRevision: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: "offline-revision-1",
          createdAt: new Date("2026-06-30T10:00:00.000Z"),
          confirmedAt: new Date("2026-06-30T10:00:00.000Z"),
          ...data
        })),
        findMany: jest.fn().mockResolvedValue([
          { id: "revision-new", createdAt: new Date("2026-06-30T10:00:00.000Z") },
          { id: "revision-old", createdAt: new Date("2026-06-30T09:00:00.000Z") }
        ])
      },
      auditLog: { create: jest.fn() },
      ...overrides
    };
  }

  function makeService(tx: ReturnType<typeof makeTx>) {
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      contractGeneratedDocument: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaService;
    const businessNumbers = {
      allocateDaily: jest.fn().mockResolvedValue("HT-20260806-007")
    };
    return {
      service: new ContractDocumentService(
        prisma,
        audit as never,
        files as never,
        businessNumbers as never
      ),
      prisma,
      businessNumbers
    };
  }

  it("queues a document for the current draft revision with the requested attachment order", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const result = await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      attachmentFileIds: ["attachment-b", "attachment-a"]
    });

    expect(result).toMatchObject({
      id: "document-1",
      sourceRevision: 7,
      status: "queued"
    });
    expect(files.assertCanDownloadFile).toHaveBeenNthCalledWith(
      1,
      tx,
      "attachment-b",
      "owner-1"
    );
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        sourceRevision: 7,
        purpose: "draft",
        inputSnapshot: expect.objectContaining({
          documentContentRevision: 3,
          documentContentFingerprint,
          templateFileId: "layout-file-1",
          outputBaseName: "草稿-001-草稿-修订7",
          requiredKeys: expect.arrayContaining([
            "contract.name",
            "contract.temporaryCode",
            "document.watermark",
            "field.deliveryLocation",
            "field.deliveryDate"
          ]),
          attachmentOrderVersion: "upload-ordered-mixed-attachments-v1",
          attachmentFiles: [
            expect.objectContaining({ id: "attachment-b" }),
            expect.objectContaining({ id: "attachment-a" })
          ],
          renderInput: {
            values: expect.objectContaining({
              "contract.name": "钢材采购合同",
              "field.invoiceType": "增值税专用发票",
              "field.taxRatePercent": "13%",
              "field.projectName": "建设项目一期",
              "field.deliveryLocation": "项目现场",
              "party.owner.name": "建工智管建设有限公司",
              "party.party_b.name": "示例供应商",
              "party.counterparty.name": "示例供应商",
              "document.watermark": "草稿"
            })
          }
        })
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract.document.queue",
        metadata: expect.objectContaining({
          sourceRevision: 7,
          documentContentRevision: 3,
          documentContentFingerprint
        })
      })
    );
    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(
      tx,
      "attachment-a",
      "owner-1"
    );
  });

  it.each([true, false])("changes unsupported-file admission only for the new mixed export (mixed %s)", async mixed => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const attachment = (id: string, originalName: string, mimeType: string) => ({ id, originalName, mimeType });
    const docx = attachment("attachment-x", "补充文件.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const selected = mixed
      ? [attachment("attachment-b", "附件B.pdf", "application/pdf"), attachment("attachment-a", "附件A.png", "image/png"), docx]
      : [docx];
    for (const file of selected) files.assertCanDownloadFile.mockResolvedValueOnce(file);
    const result = service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1", purpose: "draft",
      attachmentFileIds: selected.map(file => file.id)
    });
    if (mixed) {
      await expect(result).rejects.toThrow("合同生成只支持 PDF、PNG 或 JPEG 附件");
      expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toMatchObject({ status: "queued" });
      expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        inputSnapshot: expect.objectContaining({ attachmentFiles: [docx] })
      }) });
    }
  });

  it.each(["equipment-rental-real-v1.docx","material-purchase-real-v1.docx","labor-subcontract-real-v1.docx"])("freezes the party-placement version for a newly queued legacy %s document", async (filename) => {
    const mechanical=readFileSync(join(__dirname,"../../assets/templates",filename));
    const sourcePositions=readLayoutSourcePositions(mechanical);
    const bindings=sourcePositions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],
      ["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{
      const start=position.text.indexOf(token);
      return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];
    }));
    const mechanicalMapping=prepareLayoutSourceMapping(mechanical,"layout-file-1",2,bindings).mapping;
    const tx=makeTx();
    const layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mechanicalMapping,confirmation:{sourceFileId:mechanicalMapping.sourceFileId,sourceSha256:mechanicalMapping.sourceSha256,draftRevision:2,mappingFingerprint:mechanicalMapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    files.getFileBuffer.mockResolvedValueOnce({buffer:mechanical,file:{id:"layout-file-1",storageStatus:"active",contentSha256:sourcePositions.sourceSha256}});
    const {service}=makeService(tx);
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.partyDetailsVersion).toBe(filename.startsWith("labor")?"built-in-automatic-party-guard-v1:built-in-labor-signature-legacy-v3":filename.startsWith("equipment")?"built-in-automatic-party-guard-v1:built-in-legacy-mechanical-source-bound-v1":"built-in-automatic-party-guard-v1:built-in-legacy-signature-bank-v1");
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.mechanicalContactLayoutVersion).toBe(filename.startsWith("equipment") ? "mechanical-contact-layout-v2" : undefined);
  });
  it("refuses a legacy mechanical system-field mapping before queue and keeps the draft",async()=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx")),positions=readLayoutSourcePositions(source);
    const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const field=positions.positions.find(position=>position.part==="word/document.xml"&&position.text.replace(/\s+/gu,"").includes("甲方开票信息"))!;bindings.push({positionId:field.positionId,start:0,end:field.text.length,fieldKey:"field.useLocation"});
    const mapping=prepareLayoutSourceMapping(source,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    files.getFileBuffer.mockResolvedValueOnce({buffer:source,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("合同正文内容已保留");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });
  it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"].flatMap(filename=>["party_a","party_b"].map(missing=>[filename,missing]))) ("rejects missing %s legacy party %s before queueing",async(filename,missing)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(source);
    const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(source,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();delete version.numericProtocolVersion;delete version.draftData.contractBasics;
    const parties=[{roleKey:"party_a",displayOrder:0,snapshot:{name:missing==="party_a"?"  ":"虚构甲方"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:missing==="party_b"?"  ":"虚构乙方"}}];tx.contractPartySnapshot.findMany.mockResolvedValue(parties);
    files.getFileBuffer.mockResolvedValueOnce({buffer:source,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("请先填写合同甲乙双方名称，再生成合同");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();expect(parties.find(p=>p.roleKey===missing)?.snapshot.name).toBe("  ");
  });
  it.each(["inside", "upward"])("freezes explicitly bound company bank values and a distinct worker gate for %s on a real template queue",async(relationship)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),positions=readLayoutSourcePositions(source);
    const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(source,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    tx.companyEntity.findUnique.mockResolvedValue({id:"entity-1",isActive:true,dataStatus:"complete",currentVersionNo:3});
    const version=await tx.contractVersion.findUnique();
    const contract=await tx.contract.findUnique(); Object.assign(contract,{projectId:"project-1",companyEntityId:"entity-1"});
    Object.assign(version,{numericProtocolVersion:2,changeType:"original",amountYuan:null,draftData:{contractName:"虚构合同",contractBasics:{relationship},companyEntitySelection:{id:"entity-1",versionId:"version-3",versionNo:3,name:"虚构甲方",unifiedSocialCreditCode:"TEST",registeredAddress:""},companyBankBinding:{protocolVersion:1,companyEntityId:"entity-1",companyEntityVersionId:"version-3",companyEntityVersionNo:3,values:{openingBank:"虚构开户",bankAccount:"A001",paymentBank:"",paymentAccount:""}}}});
    tx.contractPartySnapshot.findMany.mockResolvedValue([...(relationship === "inside" ? [{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",bankAccount:"A001"}}] : []),{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:source,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;
    expect(snapshot.bodyDocument.partyDetailsVersion).toBe("built-in-automatic-party-guard-v1:built-in-company-bank-binding-v1:built-in-mapped-material-signature-v1");
    expect(snapshot.renderInput.values).toMatchObject({"party.owner.bankAccount":"A001","party.counterparty.bankAccount":"B001"});
  });
  it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"])("projects both parties' saved bank values for newly queued legacy %s",async(filename)=>{
    const source=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(source);
    const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(source,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"虚构甲开户",bankAccount:"A001"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"虚构乙开户",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:source,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;
    expect(snapshot.partyDetailsVersion).toBe(filename.startsWith("equipment")?"built-in-automatic-party-guard-v1:built-in-legacy-mechanical-source-bound-v1":"built-in-automatic-party-guard-v1:built-in-legacy-signature-bank-v1");
    expect(snapshot.renderInput.values).toMatchObject({"party.owner.openingBank":"虚构甲开户","party.owner.bankAccount":"A001","party.counterparty.openingBank":"虚构乙开户","party.counterparty.bankAccount":"B001"});
    const signatureIndex=filename.startsWith("material")?206:189,signatureId=positions.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===signatureIndex)?.positionId??createHash("sha256").update(JSON.stringify([positions.sourceSha256,signatureIndex])).digest("hex");
    const version=await tx.contractVersion.findUnique();Object.assign(version,{draftData:{...version.draftData,documentBody:{protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[{positionId:signatureId,text:"保存后自由补充"}]}}});
    files.getFileBuffer.mockResolvedValueOnce({buffer:source,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const savedSnapshot=tx.contractGeneratedDocument.create.mock.calls[1][0].data.inputSnapshot;
    expect(savedSnapshot.bodyDocument.partyDetailsVersion).toBe("built-in-automatic-party-guard-v1:built-in-legacy-body-signature-v1");
    expect(savedSnapshot.bodyDocument.editPlan.edits).toContainEqual({positionId:signatureId,text:"保存后自由补充"});
    const mapped=prepareLayoutSourceMapping(source,"layout-file-1",2,bindings).docx;
    const exported=renderContractBody(source,mapped,savedSnapshot.renderInput,[],"layout-1",savedSnapshot.bodyDocument.editPlan,{partyDetailsVersion:"built-in-legacy-body-signature-v1"});
    expect(exported.blocks.find(block=>block.id===signatureId)?.text).toBe("保存后自由补充");
    expect(exported.flow.some(node=>node.kind==="paragraph"&&node.paragraphId===signatureId)).toBe(true);
  });
  it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"])("freezes the signature supplement version for new %s body jobs",async(filename)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"甲开户",bankAccount:"A001",paymentBank:"甲收款",paymentAccount:"A002"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"乙开户",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;
    expect(snapshot.bodyDocument.partyDetailsVersion).toBe("built-in-automatic-party-guard-v1:built-in-mapped-material-signature-v1");
    expect(snapshot.mappedSignatureVersion).toBe("built-in-mapped-signature-supplement-v1");
    expect(snapshot.imagePlacementVersion).toBeUndefined();
    expect(snapshot.renderInput.values).toMatchObject({"party.owner.openingBank":"甲开户","party.owner.bankAccount":"A001","party.owner.paymentBank":"甲收款","party.owner.paymentAccount":"A002","party.counterparty.openingBank":"乙开户","party.counterparty.bankAccount":"B001"});
  });
  it.each([["material-purchase-real-v1.docx",207,214],["equipment-rental-real-v1.docx",189,195]])("queues mapped numeric v2 signature supplements for %s",async(filename,ownerIndex,otherIndex)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    for(const [index,fieldKey] of [[ownerIndex,"field.useLocation"],[otherIndex,"field.projectName"]] as const){const position=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===index)!;bindings.push({positionId:position.positionId,start:0,end:position.text.length,fieldKey});}
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{...version.draftData,fieldValues:{useLocation:"甲方虚构银行账号补充",projectName:"乙方虚构开户补充"}}});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"甲开户",bankAccount:"A001",paymentBank:"甲收款",paymentAccount:"A002"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"乙开户",bankAccount:"B001"}}]);
    const sourceFile={buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}};files.getFileBuffer.mockResolvedValueOnce(sourceFile).mockResolvedValueOnce(sourceFile);
    const service=makeService(tx).service;await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;
    expect(snapshot.bodyDocument.partyDetailsVersion).toBe("built-in-automatic-party-guard-v1:built-in-mapped-material-signature-v1");
    expect(snapshot.mappedSignatureVersion).toBe("built-in-mapped-signature-supplement-v1");
    expect(snapshot.imagePlacementVersion).toBeUndefined();
    expect(snapshot.renderInput.values).toMatchObject({"party.owner.openingBank":"甲开户","party.owner.bankAccount":"A001","party.owner.paymentBank":"甲收款","party.owner.paymentAccount":"A002","party.counterparty.openingBank":"乙开户","party.counterparty.bankAccount":"B001"});
    const owner=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===ownerIndex)!,other=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===otherIndex)!,mapped=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).docx;
    const plan={protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[{positionId:owner.positionId,text:"甲方保存后账号自由原文"}]};
    const pending=renderContractBody(input,mapped,snapshot.renderInput,[],"layout-1",plan,{partyDetailsVersion:"built-in-signature-supplement-company-v3",mappedSignatureSupplement:true,partyDetailsConflictPreview:true});
    Object.assign(plan,{signatureSupplementReviewDigest:pending.signatureSupplementReview!.digest});Object.assign(version.draftData,{documentBody:plan});
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});const saved=tx.contractGeneratedDocument.create.mock.calls[1][0].data.inputSnapshot;
    expect(saved.mappedSignatureVersion).toBe("built-in-mapped-signature-supplement-v1");expect(saved.bodyDocument.editPlan.edits).toContainEqual(plan.edits[0]);
    const output=renderContractBody(input,mapped,saved.renderInput,[],"layout-1",saved.bodyDocument.editPlan,{partyDetailsVersion:"built-in-signature-supplement-company-v3",mappedSignatureSupplement:saved.mappedSignatureVersion==="built-in-mapped-signature-supplement-v1"});
    expect(output.blocks.find(block=>block.id===owner.positionId)?.text).toBe(plan.edits[0].text);expect(output.blocks.find(block=>block.id===other.positionId)?.text).toContain("乙方虚构开户补充");
  });
  it.each(["generic-contract-v1.docx","labor-subcontract-real-v1.docx"])("freezes trusted bank values for new %s body jobs",async(filename)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    if(filename.startsWith("generic")){const owner=positions.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"甲开户",bankAccount:"A001",paymentBank:"甲收款",paymentAccount:"A002"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"乙开户",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;
    expect(snapshot.bodyDocument.partyDetailsVersion).toBe(filename.startsWith("generic")?"built-in-automatic-party-guard-v1:built-in-mapped-generic-body-v1":"built-in-automatic-party-guard-v1:built-in-labor-signature-review-v3");
    if(filename.startsWith("generic"))expect(snapshot.mappedSignatureVersion).toBe("built-in-mapped-signature-supplement-v1");
    expect(snapshot.imagePlacementVersion).toBeUndefined();
    expect(snapshot.renderInput.values).toMatchObject({"party.owner.openingBank":"甲开户","party.owner.bankAccount":"A001","party.owner.paymentBank":"甲收款","party.owner.paymentAccount":"A002","party.counterparty.openingBank":"乙开户","party.counterparty.bankAccount":"B001"});
  });
  it.each(["generic-contract-v1.docx","labor-subcontract-real-v1.docx"])("rejects bank values without an authoritative party binding in %s",async(filename)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    if(filename.startsWith("generic")){const owner=positions.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{companyEntitySelection:{name:"虚构甲方",unifiedSocialCreditCode:"TEST"}}});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"甲开户",bankAccount:"A001",paymentBank:"甲收款",paymentAccount:"A002"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"乙开户",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("合同主体与银行资料无法对应");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });
  it.each(["generic-contract-v1.docx","labor-subcontract-real-v1.docx"])("rejects overlong bank values without changing the saved party in %s",async(filename)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    if(filename.startsWith("generic")){const owner=positions.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"甲".repeat(41),bankAccount:"A001",paymentBank:"甲收款",paymentAccount:"A002"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"乙开户",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("甲方开户行请改为单行且不超过40个字");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    const parties=await tx.contractPartySnapshot.findMany();expect(parties[0].snapshot.openingBank).toBe("甲".repeat(41));
  });
  it.each([["generic-contract-v1.docx","\ufffe"],["generic-contract-v1.docx","\ud800"],["labor-subcontract-real-v1.docx","\uffff"],["labor-subcontract-real-v1.docx","\udfff"]])("rejects XML-invalid bank values without changing the saved party in %s",async(filename,invalid)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    if(filename.startsWith("generic")){const owner=positions.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:invalid,bankAccount:"A001",paymentBank:"甲收款",paymentAccount:"A002"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方",openingBank:"乙开户",bankAccount:"B001"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("甲方开户行请改为单行且不超过40个字");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    const parties=await tx.contractPartySnapshot.findMany();expect(parties[0].snapshot.openingBank).toBe(invalid);
  });
  it.each([["equipment-rental-real-v1.docx",189],["material-purchase-real-v1.docx",206]])("requires the new declaration before queueing %s",async(filename,index)=>{
    const input=readFileSync(join(__dirname,"../../assets/templates",filename)),positions=readLayoutSourcePositions(input);
    const positionId=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===index)?.positionId??createHash("sha256").update(JSON.stringify([positions.sourceSha256,index])).digest("hex");
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const prepared=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings),mapping=prepared.mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const plan={protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[{positionId,text:"虚构补充"}]};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{documentBody:plan}});
    const sourceFile={buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}};
    files.getFileBuffer.mockResolvedValueOnce(sourceFile).mockResolvedValueOnce(sourceFile).mockResolvedValueOnce(sourceFile);
    const service=makeService(tx).service;
    await expect(service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("核对");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    const preview=renderContractBody(input,prepared.docx,{values:{"contract.name":"虚构合同","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方","contract.temporaryCode":"TEST","document.watermark":"草稿"}},[],"layout-1",plan,{partyDetailsVersion:"built-in-signature-supplement-v1" as never,partyDetailsConflictPreview:true});
    Object.assign(plan,{signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest});
    await expect(service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("核对内容及甲乙方归属");
    const upgraded=renderContractBody(input,prepared.docx,{values:{"contract.name":"虚构合同","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方","contract.temporaryCode":"TEST","document.watermark":"草稿"}},[],"layout-1",plan,{partyDetailsVersion:"built-in-signature-supplement-company-v2" as never,partyDetailsConflictPreview:true});
    Object.assign(plan,{signatureSupplementReviewDigest:upgraded.signatureSupplementReview!.digest});
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledTimes(1);expect(plan.edits[0].text).toBe("虚构补充");
  }, 30_000);
  it("requires company-and-bank review before queueing generic signature edits",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),positions=readLayoutSourcePositions(input);
    const target=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===54)!;
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const owner=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});
    const counter=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===59)!;bindings.push({positionId:counter.positionId,start:0,end:counter.text.length,fieldKey:"field.useLocation"});
    const prepared=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings),mapping=prepared.mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const plan={protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[{positionId:target.positionId,text:"甲方银行账号自由补充"}]};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{documentBody:plan,fieldValues:{useLocation:"乙方银行账号自由补充"}}});
    const sourceFile={buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}};
    files.getFileBuffer.mockResolvedValueOnce(sourceFile).mockResolvedValueOnce(sourceFile);
    const service=makeService(tx).service;
    await expect(service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("核对内容及甲乙方归属");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    const preview=renderContractBody(input,prepared.docx,{values:{"contract.name":"虚构合同","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方","contract.temporaryCode":"TEST","document.watermark":"草稿","field.useLocation":"乙方银行账号自由补充"}},[],"layout-1",plan,{partyDetailsVersion:"built-in-generic-signature-review-v3" as never,partyDetailsConflictPreview:true,genericMappedSupplement:true});
    Object.assign(plan,{signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest});
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledTimes(1);expect(plan.edits[0].text).toBe("甲方银行账号自由补充");
  });
  it("requires review for a labor main signature edit before queueing",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),positions=readLayoutSourcePositions(input);
    const positionId=createHash("sha256").update(JSON.stringify([positions.sourceSha256,145])).digest("hex");
    const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const prepared=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings),mapping=prepared.mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const plan={protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[{positionId,text:"虚构签署说明"}]};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{documentBody:plan}});
    const sourceFile={buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}};
    files.getFileBuffer.mockResolvedValueOnce(sourceFile).mockResolvedValueOnce(sourceFile);
    const service=makeService(tx).service;
    await expect(service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("核对内容及甲乙方归属");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    const preview=renderContractBody(input,prepared.docx,{values:{"contract.name":"虚构合同","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方","contract.temporaryCode":"TEST","document.watermark":"草稿"}},[],"layout-1",plan,{partyDetailsVersion:"built-in-labor-signature-review-v3" as never,partyDetailsConflictPreview:true});
    Object.assign(plan,{signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest});
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledTimes(1);expect(plan.edits[0].text).toBe("虚构签署说明");
  });
  it("does not attach a legacy party bank account to an independent authoritative company",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{companyEntitySelection:{name:"虚构甲方",unifiedSocialCreditCode:"TEST"}}});
    const party={roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",unifiedSocialCreditCode:"TEST",bankAccount:"A001"}};
    tx.contractPartySnapshot.findMany.mockResolvedValue([party,{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("核对");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();expect(party.snapshot.bankAccount).toBe("A001");
  });
  it("preserves an edited mapped signature field and requires review before queueing",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx")),positions=readLayoutSourcePositions(input);
    const target=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===189)!;
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    bindings.push({positionId:target.positionId,start:0,end:1,fieldKey:"field.useLocation"});
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const plan={protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[{positionId:target.positionId,text:"用户原始编辑"}]};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null,draftData:{documentBody:plan}});
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("核对内容及甲乙方归属");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();expect(plan.edits[0].text).toBe("用户原始编辑");
  });
  it("freezes a distinct glyph-check version for a new labor docx4j job",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.bodyDocument.partyDetailsVersion).toBe("built-in-automatic-party-guard-v1:built-in-labor-signature-review-v3");
  });
  it.each([
    ["   ", "请先填写合同甲乙双方名称"],
    ["甲".repeat(81), "合同主体名称过长或含不支持的字符"],
    ["甲\uffff方", "合同主体名称过长或含不支持的字符"],
    ["甲\ud800方", "合同主体名称过长或含不支持的字符"]
  ])("rejects an invalid labor party name before queueing", async (name, message) => {
    const input=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx"));
    const positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],
      ["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const sourceMapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping;
    const tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...sourceMapping,confirmation:{sourceFileId:sourceMapping.sourceFileId,sourceSha256:sourceMapping.sourceSha256,draftRevision:2,mappingFingerprint:sourceMapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow(message);
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });
  it("rejects queuing before creating a document when a confirmed layout maps the removed billing block", async () => {
    const input=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
    const positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],
      ["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===94)!;
    bindings.push({positionId:target.positionId,start:0,end:1,fieldKey:"field.useLocation"});
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping;
    const tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    const {service}=makeService(tx);
    await expect(service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("正文开票资料与当前版式映射冲突");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });
  it("rejects a labor party mapping in the ordinary contract body before queueing",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx")),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const ordinary=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===35)!;
    bindings.push({positionId:ordinary.positionId,start:0,end:1,fieldKey:"party.owner.name"});
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("合同正文内容已保留");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });
  it("freezes the source-bound font-table version only for a newly queued built-in generic document",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),sourcePositions=readLayoutSourcePositions(input);
    const bindings=sourcePositions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const owner=sourcePositions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===13)!;
    const ownerStart=owner.text.indexOf("建工智管建设有限公司");
    bindings.push({positionId:owner.positionId,start:ownerStart,end:ownerStart+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:sourcePositions.sourceSha256}});
    const {service}=makeService(tx);
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.genericFontTableVersion).toBe("built-in-generic-font-v1");
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.partyDetailsVersion).toBe("built-in-automatic-party-guard-v1:built-in-mapped-generic-legacy-v1");
  });

  it.each(["party_a","party_b"])("requires %s before queueing a generic contract",async missing=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const owner=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===13)!;
    const start=owner.text.indexOf("建工智管建设有限公司");
    bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});
    const sourceMapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...sourceMapping,confirmation:{sourceFileId:sourceMapping.sourceFileId,sourceSha256:sourceMapping.sourceSha256,draftRevision:2,mappingFingerprint:sourceMapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:missing==="party_a"?"party_b":"party_a",displayOrder:0,snapshot:{name:"虚构主体"}}]);
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("请先填写合同甲乙双方名称");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it.each([undefined,2])("rejects mixed generic party and free signature mappings before queueing (protocol %s)",async protocol=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),positions=readLayoutSourcePositions(input),target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===54)!;
    const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const owner=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===13)!,name="建工智管建设有限公司",start=owner.text.indexOf(name);bindings.push({positionId:owner.positionId,start,end:start+name.length,fieldKey:"party.owner.name"});
    bindings.push({positionId:target.positionId,start:0,end:1,fieldKey:"party.owner.name"},{positionId:target.positionId,start:1,end:2,fieldKey:"field.useLocation"});
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:protocol,amountYuan:null});Object.assign(version.draftData,{fieldValues:{useLocation:"虚构自由原文银行账号"}});
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await expect(makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("合同正文内容已保留");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();expect(version.draftData.fieldValues.useLocation).toBe("虚构自由原文银行账号");
  });
  it("queues mapped free signature content for the new generic placement",async()=>{
    const input=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx")),positions=readLayoutSourcePositions(input);
    const bindings=positions.positions.flatMap(position=>[
      ["{合同名称}","contract.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]
    ].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
    const owner=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===13)!,name="建工智管建设有限公司",start=owner.text.indexOf(name);
    bindings.push({positionId:owner.positionId,start,end:start+name.length,fieldKey:"party.owner.name"});
    const signature=positions.positions.find(position=>position.part==="word/document.xml"&&position.paragraphIndex===56)!;
    bindings.push({positionId:signature.positionId,start:0,end:signature.text.length,fieldKey:"field.useLocation"});
    const mapping=prepareLayoutSourceMapping(input,"layout-file-1",2,bindings).mapping,tx=makeTx(),layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();
    Object.assign(version.draftData,{fieldValues:{useLocation:"虚构开户银行资料"}});
    files.getFileBuffer.mockResolvedValueOnce({buffer:input,file:{id:"layout-file-1",storageStatus:"active",contentSha256:positions.sourceSha256}});
    await makeService(tx).service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.imagePlacementVersion).toBeUndefined();
  });


  function makeSingleConnectionService(current: { storageStatus?: string; objectKey?: string } = {}, bytes = source) {
    const file = { id: "layout-file-1", objectKey: "private/layout.docx", storageStatus: "active",
      contentSha256: createHash("sha256").update(source).digest("hex") };
    const fileObject = { findUnique: jest.fn().mockResolvedValue(file) };
    const tx = { ...makeTx(), fileObject, contractDraftCheckpoint: { findMany: jest.fn().mockResolvedValue([]) } };
    let held = false;
    const poolLookup = jest.fn(async () => {
      if (held) throw new Error("only connection is held by the transaction");
      return { ...file, ...current };
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
        held = true;
        try { return await callback(tx); } finally { held = false; }
      }),
      fileObject: { findUnique: poolLookup }
    } as unknown as PrismaService;
    const read = jest.fn().mockResolvedValue(bytes);
    const storage = { read } as unknown as PrivateFileStorage;
    const service = new ContractDocumentService(prisma, audit as never, new FileService(prisma, audit as never, storage), {} as never);
    return { service, file, fileObject, poolLookup, read, tx };
  }

  it.each([true, false])("queues using the held connection only when the layout bytes match: %s", async (matching) => {
    const { service, file, fileObject, poolLookup, read, tx } = makeSingleConnectionService({}, matching ? source : Buffer.from("changed layout"));
    const queued = service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1", purpose: "draft", attachmentFileIds: []
    });
    if (matching) {
      await expect(queued).resolves.toMatchObject({ status: "queued" });
    } else {
      await expect(queued).rejects.toThrow("资料文件完整性校验失败");
      expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    }
    expect(poolLookup).not.toHaveBeenCalled();
    expect(fileObject.findUnique).toHaveBeenCalledWith({ where: { id: file.id } });
    expect(read).toHaveBeenCalledWith(file.objectKey);
  });

  it.each([
    { current: {}, error: null },
    { current: { storageStatus: "purged" }, error: "资料文件当前不可用" },
    { current: { objectKey: "private/replaced.docx" }, error: "版式原文件已变化" }
  ])("checks current draft-body file metadata after releasing the snapshot: $current", async ({ current, error }) => {
    const { service, file, fileObject, poolLookup, read } = makeSingleConnectionService(current);
    const body = service.getDraftBody("version-1", "owner-1");
    if (error) await expect(body).rejects.toThrow(error);
    else await expect(body).resolves.toMatchObject({ sourceSha256: file.contentSha256, mechanicalContactLayoutVersion:null });
    expect(fileObject.findUnique).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(poolLookup).toHaveBeenCalledTimes(1);
  });

  it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx","labor-subcontract-real-v1.docx","generic-contract-v1.docx"])("previews and queues repacked %s with its actual source hash",async filename=>{
    const original=readFileSync(join(__dirname,"../../assets/templates",filename)),zip=new PizZip(original);zip.comment="synthetic repack";const bytes=zip.generate({type:"nodebuffer"});
    const {service,file,tx}=makeSingleConnectionService({},bytes);file.contentSha256=createHash("sha256").update(bytes).digest("hex");
    const positions=readLayoutSourcePositions(bytes);
    const bindings=positions.positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    if(filename.startsWith("generic")){const owner=positions.positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
    const mapping=prepareLayoutSourceMapping(bytes,"layout-file-1",2,bindings).mapping,layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方"}}]);
    const preview=await service.getDraftBody("version-1","owner-1","2");expect(preview.sourceSha256).toBe(file.contentSha256);
    const indexes=filename.startsWith("labor")?[27,28]:filename.startsWith("generic")?[]:[28,29];
    for(const index of indexes){const id=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===index)?.positionId;expect(preview.blocks.find(block=>block.id===id)?.text??"").not.toMatch(/虚构甲方|虚构乙方/u);}
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;expect(snapshot.bodyDocument.sourceSha256).toBe(file.contentSha256);expect(snapshot.bodyDocument.partyDetailsVersion).toMatch(/^built-in-automatic-party-guard-v1:built-in-equivalent-v1:/u);if(filename.startsWith("generic"))expect(snapshot.genericFontTableVersion).toBe("built-in-equivalent-generic-font-v1");
  });

  it("treats a Unicode-path override as a custom template in preview and queue",async()=>{
    const original=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
    const bytes=unicodePathOverride(original,"synthetic-styles.xml","word/styles.xml");
    const {service,file,tx}=makeSingleConnectionService({},bytes);file.contentSha256=createHash("sha256").update(bytes).digest("hex");
    const positions=readLayoutSourcePositions(bytes);
    const bindings=positions.positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(bytes,"layout-file-1",2,bindings).mapping,layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方"}}]);
    const preview=await service.getDraftBody("version-1","owner-1","2");expect(preview.sourceSha256).toBe(file.contentSha256);
    await service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]});
    const snapshot=tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;expect(snapshot.bodyDocument.sourceSha256).toBe(file.contentSha256);expect(snapshot.bodyDocument.partyDetailsVersion).toBeUndefined();
  });

  it.each([undefined,2])("warns in preview and refuses an ordinary-body automatic party mapping (protocol %s)",async protocol=>{
    const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),positions=readLayoutSourcePositions(source);
    const bindings=positions.positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    const target=positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===51)!;bindings.push({positionId:target.positionId,start:0,end:3,fieldKey:"party.owner.name"});
    const mapping=prepareLayoutSourceMapping(source,"layout-file-1",2,bindings).mapping,{service,file,tx}=makeSingleConnectionService({},source);file.contentSha256=positions.sourceSha256;
    const layout=await tx.contractLayoutTemplateVersion.findUnique();layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:protocol,amountYuan:null});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方"}}]);
    const preview=await service.getDraftBody("version-1","owner-1","2");expect(preview.warnings).toContain("主体、银行资料或版式映射需要核对，请保留内容并联系合同管理员处理。");
    const edited=preview.blocks.find(block=>block.editable&&block.id!==target.positionId)!;expect(edited).toBeDefined();
    const edit={positionId:edited.id,text:"虚构自由补充银行文字原样保留"};version.draftData={...version.draftData,documentBody:{protocolVersion:1,layoutTemplateVersionId:"layout-1",sourceSha256:positions.sourceSha256,edits:[edit]}};const before=JSON.stringify(version.draftData);
    const reloaded=await service.getDraftBody("version-1","owner-1","2");expect(reloaded.blocks.find(block=>block.id===edit.positionId)?.text).toBe(edit.text);expect(reloaded.warnings).toContain("主体、银行资料或版式映射需要核对，请保留内容并联系合同管理员处理。");
    await expect(service.queue("version-1","owner-1",{layoutTemplateVersionId:"layout-1",purpose:"draft",attachmentFileIds:[]})).rejects.toThrow("合同正文内容已保留");expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();expect(JSON.stringify(version.draftData)).toBe(before);
  });

  it("publishes the mechanical presentation version with the current draft body",async()=>{
    const bytes=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
    const {service,file,tx}=makeSingleConnectionService({},bytes);file.contentSha256=createHash("sha256").update(bytes).digest("hex");
    const positions=readLayoutSourcePositions(bytes).positions;
    const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    const mapping=prepareLayoutSourceMapping(bytes,"layout-file-1",2,bindings).mapping,layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    await expect(service.getDraftBody("version-1","owner-1")).resolves.toMatchObject({sourceSha256:file.contentSha256,mechanicalContactLayoutVersion:"mechanical-contact-layout-v2"});
  });

  it.each([["material-purchase-real-v1.docx",207,214],["equipment-rental-real-v1.docx",189,195]])("shows both mapped signature supplements before the table with stable editable IDs for legacy %s",async(filename,ownerIndex,otherIndex)=>{
    const bytes=readFileSync(join(__dirname,"../../assets/templates",filename));
    const {service,file,tx}=makeSingleConnectionService({},bytes);file.contentSha256=createHash("sha256").update(bytes).digest("hex");
    const positions=readLayoutSourcePositions(bytes).positions;
    const owner=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===ownerIndex)!,other=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===otherIndex)!;
    const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    bindings.push({positionId:owner.positionId,start:0,end:1,fieldKey:"field.deliveryLocation"},{positionId:other.positionId,start:0,end:1,fieldKey:"field.projectName"});
    const mapping=prepareLayoutSourceMapping(bytes,"layout-file-1",2,bindings).mapping,layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{draftData:{...version.draftData,deliveryLocation:"甲方自由补充",projectName:"乙方自由补充"}});
    const before=await service.getDraftBody("version-1","owner-1");
    const ownerFlow=before.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===owner.positionId),otherFlow=before.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===other.positionId);
    expect(ownerFlow).toBeGreaterThanOrEqual(0);expect(otherFlow).toBeGreaterThan(ownerFlow);
    expect(before.blocks.find(block=>block.id===owner.positionId)?.text).toContain("甲方自由补充");expect(before.blocks.find(block=>block.id===other.positionId)?.text).toContain("乙方自由补充");
    const manual="甲方手工虚构公司账号".repeat(100);
    Object.assign(version,{draftData:{...version.draftData,documentBody:{protocolVersion:1,layoutTemplateVersionId:layout.id,sourceSha256:before.sourceSha256,edits:[{positionId:owner.positionId,text:manual}]}}});
    const after=await service.getDraftBody("version-1","owner-1");
    expect(after.blocks.find(block=>block.id===owner.positionId)?.text).toBe(manual);
    expect(after.blocks.find(block=>block.id===other.positionId)?.text).toContain("乙方自由补充");
    expect(after.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===owner.positionId)).toBeGreaterThanOrEqual(0);
    expect(after.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===other.positionId)).toBeGreaterThan(after.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===owner.positionId));
  });
  it.each([["material-purchase-real-v1.docx",207,214],["equipment-rental-real-v1.docx",189,195]])("shows both mapped signature supplements before the table with stable editable IDs for numeric v2 %s",async(filename,ownerIndex,otherIndex)=>{
    const bytes=readFileSync(join(__dirname,"../../assets/templates",filename));
    const {service,file,tx}=makeSingleConnectionService({},bytes);file.contentSha256=createHash("sha256").update(bytes).digest("hex");
    const positions=readLayoutSourcePositions(bytes).positions;
    const owner=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===ownerIndex)!,other=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===otherIndex)!;
    const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    bindings.push({positionId:owner.positionId,start:0,end:1,fieldKey:"field.deliveryLocation"},{positionId:other.positionId,start:0,end:1,fieldKey:"field.projectName"});
    const mapping=prepareLayoutSourceMapping(bytes,"layout-file-1",2,bindings).mapping,layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{numericProtocolVersion:2,draftData:{...version.draftData,deliveryLocation:"甲方自由补充",projectName:"乙方自由补充"}});
    const before=await service.getDraftBody("version-1","owner-1","2");
    const ownerFlow=before.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===owner.positionId),otherFlow=before.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===other.positionId);
    expect(ownerFlow).toBeGreaterThanOrEqual(0);expect(otherFlow).toBeGreaterThan(ownerFlow);
    expect(before.blocks.find(block=>block.id===owner.positionId)?.text).toContain("甲方自由补充");expect(before.blocks.find(block=>block.id===other.positionId)?.text).toContain("乙方自由补充");
    const manual="甲方手工虚构公司账号".repeat(100);
    Object.assign(version,{draftData:{...version.draftData,documentBody:{protocolVersion:1,layoutTemplateVersionId:layout.id,sourceSha256:before.sourceSha256,edits:[{positionId:owner.positionId,text:manual}]}}});
    const after=await service.getDraftBody("version-1","owner-1","2");
    expect(after.blocks.find(block=>block.id===owner.positionId)?.text).toBe(manual);
    expect(after.blocks.find(block=>block.id===other.positionId)?.text).toContain("乙方自由补充");
    expect(after.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===owner.positionId)).toBeGreaterThanOrEqual(0);
    expect(after.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===other.positionId)).toBeGreaterThan(after.flow.findIndex(node=>node.kind==="paragraph"&&node.paragraphId===owner.positionId));
  });
  it.each(["generic-contract-v1.docx","labor-subcontract-real-v1.docx"])("keeps %s preview readable when bank identity conflicts",async filename=>{
    const bytes=readFileSync(join(__dirname,"../../assets/templates",filename));
    const {service,file,tx}=makeSingleConnectionService({},bytes);file.contentSha256=createHash("sha256").update(bytes).digest("hex");
    const positions=readLayoutSourcePositions(bytes).positions;
    const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
    if(filename.startsWith("generic")){const owner=positions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===13)!;const start=owner.text.indexOf("建工智管建设有限公司");bindings.push({positionId:owner.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
    const mapping=prepareLayoutSourceMapping(bytes,"layout-file-1",2,bindings).mapping,layout=await tx.contractLayoutTemplateVersion.findUnique();
    layout.placeholderSchema.sourceMapping={...mapping,confirmation:{sourceFileId:mapping.sourceFileId,sourceSha256:mapping.sourceSha256,draftRevision:2,mappingFingerprint:mapping.fingerprint,previewJobId:"confirmed-preview",previewPdfFileId:"confirmed-pdf"}};
    const version=await tx.contractVersion.findUnique();Object.assign(version,{draftData:{projectName:"虚构项目",deliveryLocation:"虚构地点",deliveryDate:"2026-11-12",companyEntitySelection:{name:"虚构甲方",unifiedSocialCreditCode:"TEST"}}});
    tx.contractPartySnapshot.findMany.mockResolvedValue([{roleKey:"party_a",displayOrder:0,snapshot:{name:"虚构甲方",openingBank:"虚构开户行"}},{roleKey:"party_b",displayOrder:0,snapshot:{name:"虚构乙方"}}]);
    const preview=await service.getDraftBody("version-1","owner-1");
    expect(preview.blocks.length).toBeGreaterThan(0);
    expect(preview.warnings).toContain("主体、银行资料或版式映射需要核对，请保留内容并联系合同管理员处理。");
  });

  it("allocates and locks a formal contract code on first external-file generation", async () => {
    const tx = makeTx();
    const { service, businessNumbers } = makeService(tx);

    const result = await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "external",
      attachmentFileIds: ["attachment-a"]
    });

    expect(result).toMatchObject({ id: "document-1", status: "queued", purpose: "external" });
    expect(businessNumbers.allocateDaily).toHaveBeenCalledWith(tx, "HT");
    expect(tx.contract.updateMany).toHaveBeenCalledWith({
      where: { id: "contract-1", code: null, voidedAt: null },
      data: { code: "HT-20260806-007" }
    });
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "external",
        inputSnapshot: expect.objectContaining({
          outputBaseName: "HT-20260806-007-外发合同-修订7",
          renderInput: {
            values: expect.objectContaining({
              "contract.code": "HT-20260806-007",
              "document.watermark": ""
            })
          }
        })
      })
    });
  });

  it("refuses a tombstoned formal code before external-file generation writes it", async () => {
    const tx = makeTx({
      contractNumberTombstone: {
        findUnique: jest.fn().mockResolvedValue({ id: "tombstone-1" })
      }
    });
    const { service, businessNumbers } = makeService(tx);

    const failure = await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "external",
      attachmentFileIds: []
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ConflictException);
    expect((failure as ConflictException).getResponse()).toMatchObject({
      code: "CONTRACT_FORMAL_CODE_TOMBSTONED"
    });
    expect(businessNumbers.allocateDaily).toHaveBeenCalledWith(tx, "HT");
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("reuses the locked formal code on repeated external-file generation", async () => {
    const tx = makeTx({
      contract: {
        findUnique: jest.fn().mockResolvedValue({
          id: "contract-1",
          ownerUserId: "owner-1",
          voidedAt: null,
          name: "钢材采购合同",
          contractTypeKey: "materials",
          temporaryCode: "草稿-001",
          code: "HT-20260806-007"
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service, businessNumbers } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "external",
      attachmentFileIds: []
    });

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "external",
        inputSnapshot: expect.objectContaining({
          renderInput: {
            values: expect.objectContaining({
              "contract.code": "HT-20260806-007",
              "document.watermark": ""
            })
          }
        })
      })
    });
  });

  it("keeps the legacy draft watermark without allocating a formal code", async () => {
    const tx = makeTx();
    const { service, businessNumbers } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      attachmentFileIds: []
    });

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: "draft",
        inputSnapshot: expect.objectContaining({
          renderInput: {
            values: expect.objectContaining({
              "document.watermark": "草稿"
            })
          }
        })
      })
    });
  });

  it("rejects external generation when the code allocation gate is contested, without creating a document", async () => {
    const tx = makeTx();
    tx.contract.updateMany.mockResolvedValue({ count: 0 });
    const { service, businessNumbers } = makeService(tx);

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "external",
        attachmentFileIds: []
      })
    ).rejects.toThrow("合同正式编号");

    expect(businessNumbers.allocateDaily).toHaveBeenCalledTimes(1);
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("keeps legacy generation purposes accepted during the extension period", async () => {
    const tx = makeTx();
    const { service, businessNumbers } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "internal_review",
      attachmentFileIds: []
    });

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ purpose: "internal_review" })
    });
  });

  it("lists legacy and external generated documents for read compatibility", async () => {
    const baseTx = makeTx();
    const tx = makeTx({
      contractGeneratedDocument: {
        ...baseTx.contractGeneratedDocument,
        findMany: jest.fn().mockResolvedValue([
          { id: "old-draft", purpose: "draft", status: "success" },
          { id: "external", purpose: "external", status: "success" }
        ])
      }
    });
    const { service } = makeService(tx);

    const result = await service.list("version-1", "owner-1");

    expect(result.map((document) => document.purpose)).toEqual(["draft", "external"]);
  });

  it("reuses the locked code snapshot when retrying a failed external generation", async () => {
    const failedDocument = {
      id: "document-1",
      contractVersionId: "version-1",
      status: "failed",
      purpose: "external",
      sourceRevision: 7,
      layoutTemplateVersionId: "layout-1",
      inputSnapshot: {
        ...documentContentCoordinates,
        templateFileId: "layout-file-1",
        outputBaseName: "HT-20260806-007-外发合同-修订7",
        renderInput: {
          values: {
            "contract.code": "HT-20260806-007",
            "document.watermark": ""
          }
        },
        requiredKeys: [],
        attachmentFiles: []
      }
    };
    const tx = makeTx({
      contractGeneratedDocument: {
        ...makeTx().contractGeneratedDocument,
        findUnique: jest.fn().mockResolvedValue(failedDocument),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service, businessNumbers } = makeService(tx);

    await service.retry("document-1", "owner-1");

    expect(businessNumbers.allocateDaily).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "document-1", status: "failed" }),
      data: expect.objectContaining({ status: "queued" })
    });
  });

  it("keeps and exposes a successful preview across metadata-only revisions", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findMany.mockResolvedValue([{
      id: "document-1",
      purpose: "draft",
      status: "success",
      sourceRevision: 6,
      inputSnapshot: documentContentCoordinates
    }]);
    const { service } = makeService(tx);

    await expect(service.list("version-1", "owner-1")).resolves.toEqual([
      expect.objectContaining({
        id: "document-1",
        status: "success",
        sourceRevision: 6,
        ...documentContentCoordinates
      })
    ]);

    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("keeps historical takeover document listing read-only when company facts drift", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "historical_takeover",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await expect(service.list("version-1", "owner-1")).resolves.toEqual([]);

    expect(tx.companyEntity.findUnique).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("requires an explicitly saved template for a new pending draft instead of falling back to a built-in layout", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique({ where: { id: "version-1" } });
    Object.assign(version, { numericProtocolVersion: 2, signingSubjectType: "draft_unconfirmed", businessTemplateVersionId: null, layoutTemplateVersionId: null,
      draftData: { contractName: "完整基础资料的新合同", contractBasics: { relationship: "inside", businessType: "material_purchase", amountBasis: "tax_inclusive" } } });
    tx.contractVersion.findUnique.mockResolvedValue(version);
    tx.contractPartySnapshot.findMany.mockResolvedValue([{ roleKey: "party_a", snapshot: { name: "甲方" } }, { roleKey: "party_b", snapshot: { name: "乙方" } }] as never);
    Object.assign(await tx.contract.findUnique({ where: { id: "contract-1" } }), { projectId: "project-1" });
    const { service } = makeService(tx);
    await expect(service.queue("version-1", "owner-1", { layoutTemplateVersionId: "layout-1", purpose: "draft" })).rejects.toThrow("请选择并保存模板");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("uses the current draft name in queued render facts without rewriting the parent contract", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique({ where: { id: "version-1" } });
    const parent = await tx.contract.findUnique({ where: { id: "contract-1" } });
    const originalName = parent.name;
    Object.assign(version, { draftData: { ...version.draftData, contractName: "仅本次草稿的新名称" } });
    tx.contractVersion.findUnique.mockResolvedValue(version);
    const { service } = makeService(tx);
    await service.queueDraftPreview("version-1", "owner-1", { sourceRevision: 7 });
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.renderInput.values["contract.name"])
      .toBe("仅本次草稿的新名称");
    expect(parent.name).toBe(originalName);
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
  });

  it("keeps incomplete basic information as a draft but locates the five key facts before generation", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique({ where: { id: "version-1" } });
    Object.assign(version, { draftData: { contractBasics: { amountBasis: "tax_inclusive" } } });
    tx.contractVersion.findUnique.mockResolvedValue(version);
    const { service } = makeService(tx);
    await expect(service.queueDraftPreview("version-1", "owner-1", { sourceRevision: 7 }))
      .rejects.toThrow("生成前请补充：");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("keeps an incomplete tax-exclusive v2 draft subject to the existing required basic facts before any document, version or audit writes", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique({ where: { id: "version-1" } });
    Object.assign(version, { numericProtocolVersion: 2, draftData: { ...version.draftData, contractBasics: { amountBasis: "tax_exclusive" } } });
    tx.contractVersion.findUnique.mockResolvedValue(version);
    const { service } = makeService(tx);
    await expect(service.queueDraftPreview("version-1", "owner-1", { sourceRevision: 7 }))
      .rejects.toThrow("生成前请补充：");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("queues the saved current revision as an idempotent draft preview command", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).resolves.toEqual({
      generationId: "document-1",
      status: "queued",
      sourceRevision: 7,
      documentContentRevision: 3,
      documentContentFingerprint
    });
    expect(tx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        purpose: "draft",
        sourceRevision: 7,
        inputSnapshot: expect.objectContaining({
          documentContentRevision: 3,
          documentContentFingerprint,
          attachmentFiles: [expect.objectContaining({ id: "attachment-a" })]
        })
      })
    });
    expect(tx.contractDraftAttachment.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: [{ slotKey: "asc" }, { displayOrder: "asc" }],
      select: { fileId: true }
    });
  });

  it("rejects generic preview generation for a historical takeover version", async () => {
    const tx = makeTx();
    tx.contractVersion.findUnique.mockResolvedValue({
      id: "version-1",
      contractId: "contract-1",
      status: "draft",
      changeType: "historical_takeover",
      draftRevision: 7
    });
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).rejects.toThrow("历史接管工作台");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("blocks relation-only takeover before queueing a generic preview", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockImplementation(
      async (query: { strings?: readonly string[] }) => {
        const sql = query.strings?.join(" ") ?? "";
        if (sql.includes("FOR UPDATE OF cv")) {
          return [{
            id: "version-1",
            contractId: "contract-1",
            changeType: "original",
            hasHistoricalTakeoverRelation: true
          }];
        }
        if (sql.includes("FOR UPDATE OF c")) {
          return [{ id: "contract-1" }];
        }
        if (sql.includes('AS "hasSignedFormalFile"')) {
          return [{
            hasSignedFormalFile: false,
            hasActiveSealTask: false,
            hasArchiveFile: false,
            hasSettlement: false,
            hasPaymentRequest: false
          }];
        }
        return [];
      }
    );
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).rejects.toMatchObject({
      response: {
        code: "HISTORICAL_TAKEOVER_WORKBENCH_REQUIRED",
        projectId: null,
        takeoverId: null
      }
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects draft preview generation after downstream business makes the draft formal", async () => {
    const tx = makeTx();
    tx.$queryRaw.mockImplementation(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(" ") ?? "";
      if (sql.includes("FOR UPDATE OF cv")) {
        return [{
          id: "version-1",
          contractId: "contract-1"
        }];
      }
      if (sql.includes("FOR UPDATE OF c")) {
        return [{ id: "contract-1", contractId: "contract-1" }];
      }
      if (sql.includes('AS "hasSignedFormalFile"')) {
        return [{
          hasSignedFormalFile: false,
          hasActiveSealTask: false,
          hasArchiveFile: false,
          hasSettlement: true,
          hasPaymentRequest: true
        }];
      }
      if (sql.includes('FROM "CompanyEntity"')) {
        return [{ id: "entity-1" }];
      }
      return [];
    });
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).rejects.toThrow("正式业务事实");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("rejects preview generation for a revision that is not the current saved draft", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 6
      })
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "DRAFT_REVISION_CONFLICT",
        latestRevision: 7
      })
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("replays the same draft preview generation for version, revision, layout and purpose", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-existing",
      status: "success",
      sourceRevision: 7,
      inputSnapshot: {
        documentContentRevision: 3,
        documentContentFingerprint
      }
    });
    const { service } = makeService(tx);

    await expect(
      service.queueDraftPreview("version-1", "owner-1", {
        sourceRevision: 7
      })
    ).resolves.toEqual({
      generationId: "document-existing",
      status: "success",
      sourceRevision: 7,
      documentContentRevision: 3,
      documentContentFingerprint
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("reuses the same preview identity after a metadata-only aggregate revision", async () => {
    const firstTx = makeTx();
    const firstVersion = await firstTx.contractVersion.findUnique();
    const { service: firstService } = makeService(firstTx);
    await firstService.queueDraftPreview("version-1", "owner-1", {
      sourceRevision: 7
    });

    const secondTx = makeTx();
    secondTx.contractVersion.findUnique.mockResolvedValue({
      ...firstVersion,
      draftRevision: 8
    });
    const { service: secondService } = makeService(secondTx);
    await secondService.queueDraftPreview("version-1", "owner-1", {
      sourceRevision: 8
    });

    expect(firstTx.contractGeneratedDocument.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: secondTx.contractGeneratedDocument.create.mock.calls[0]?.[0].data
          .idempotencyKey
      })
    });
  });

  it("returns an existing queued, processing, or successful document for the same key", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "existing-document",
      status: "processing"
    });
    const { service } = makeService(tx);

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "existing-document" });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("allows draft warnings but rejects internal review without a clean readiness snapshot", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const version = await tx.contractVersion.findUnique();

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "document-1" });

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: null
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("请先完成合同资料齐全性检查，再生成内部送审稿");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: {
        checkedRevision: 7,
        checkedDocumentContentRevision: 3,
        checkedDocumentContentFingerprint: documentContentFingerprint,
        blocking: ["合同金额缺失"],
        warnings: []
      }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("合同资料仍有阻断项，请处理后再生成内部送审稿");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      draftRevision: 8,
      readinessSnapshot: {
        checkedRevision: 7,
        checkedDocumentContentRevision: 3,
        checkedDocumentContentFingerprint: documentContentFingerprint,
        blocking: [],
        warnings: []
      }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).resolves.toMatchObject({ id: "document-1" });

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      draftRevision: 8,
      readinessSnapshot: {
        checkedRevision: 8,
        checkedDocumentContentRevision: 2,
        checkedDocumentContentFingerprint: "b".repeat(64),
        blocking: [],
        warnings: []
      }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).rejects.toThrow("合同资料检查结果已过期，请重新检查后再生成内部送审稿");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      readinessSnapshot: { blockingErrors: [], warnings: [] }
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "internal_review"
      })
    ).resolves.toMatchObject({ id: "document-1" });
  });

  it("rejects non-editable versions and layouts for another contract type", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const version = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "in_approval"
    });

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("合同草稿当前不可编辑，不能生成或修订合同文档");

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "approval_rejected"
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("合同草稿当前不可编辑，不能生成或修订合同文档");
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();

    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "draft"
    });
    tx.contractLayoutTemplate.findUnique.mockResolvedValue({
      id: "layout-template-1",
      contractTypeKey: "labor"
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("所选合同版式与当前合同类型不匹配，请重新选择");
  });

  it("returns the active winner of an idempotency race without queue audit", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.create.mockRejectedValue({ code: "P2002" });
    const { service, prisma } = makeService(tx);
    (
      prisma.contractGeneratedDocument.findUnique as jest.Mock
    ).mockResolvedValue({
      id: "winner",
      status: "queued"
    });

    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).resolves.toMatchObject({ id: "winner" });
    expect(audit.record).not.toHaveBeenCalled();

    (
      prisma.contractGeneratedDocument.findUnique as jest.Mock
    ).mockResolvedValue({
      id: "failed-winner",
      status: "failed"
    });
    await expect(
      service.queue("version-1", "owner-1", {
        layoutTemplateVersionId: "layout-1",
        purpose: "draft"
      })
    ).rejects.toThrow("上一次文档生成失败，请先重试失败记录");
  });

  it("stores JSON-safe bill values without bigint or Decimal objects", async () => {
    const decimal = (value: string) => ({
      toString: () => value,
      toFixed: (scale?: number) => Number(value).toFixed(scale ?? 0),
      toJSON: () => value
    });
    const tx = makeTx();
    tx.contractBill.findMany.mockResolvedValue([
      { id: "bill-1", billKey: "materials" }
    ]);
    tx.contractBillRow.findMany.mockResolvedValue([
      {
        contractBillId: "bill-1",
        itemCode: null,
        itemName: "钢筋",
        specification: null,
        unit: "吨",
        quantity: decimal("2.5"),
        unitPrice: decimal("3500"),
        taxRate: decimal("13"),
        taxInclusiveAmountCents: 875_000n,
        taxExclusiveAmountCents: 774_336n,
        taxAmountCents: 100_664n,
        isProvisional: true,
        settlementBasis: null,
        customData: { checked: false, unitPrice: "3500.0000", taxRatePercent: "13" }
      }
    ]);
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const snapshot = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot;
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.renderInput.values["bill.materials"][0]).toMatchObject({
      quantity: "2.5",
      unitPrice: "3500.00",
      taxInclusiveUnitPrice: "3500.00",
      taxExclusiveUnitPrice: "3097.344000",
      taxRatePercent: "13%",
      taxInclusiveAmount: "8,750.00",
      taxExclusiveAmount: "7,743.36",
      taxAmount: "1,006.64",
      isProvisional: "true",
      checked: "false"
    });
  });

  it("uses normative version tax facts instead of stale workbench mirror fields", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
          layoutTemplateVersionId: "layout-1",
          amountCents: 1_000_000n,
          invoiceType: "vat_general",
          defaultTaxRatePercent: { toString: () => "9" },
          draftData: {
            fieldValues: {
              projectName: "前端录入项目",
              taxRatePercent: "13",
              invoiceType: "增值税专用发票"
            }
          },
          clauseSnapshot: [],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const snapshot = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot;
    expect(snapshot.renderInput.values).toMatchObject({
      "field.projectName": "前端录入项目",
      "field.taxRatePercent": "9%",
      "field.invoiceType": "增值税普通发票"
    });
  });

  it("uses structured draft company facts before legacy party_a", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 3
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
          layoutTemplateVersionId: "layout-1",
          amountCents: 1_000_000n,
          invoiceType: "vat_special",
          defaultTaxRatePercent: { toString: () => "13" },
          draftData: {
            companyEntitySelection: {
              id: "entity-1",
              versionId: "entity-version-3",
              versionNo: 3,
              name: "结构化我方主体",
              unifiedSocialCreditCode: "91350211M000100Y46",
              registeredAddress: "昆明市"
            }
          },
          clauseSnapshot: [],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] },
          companyEntityIdSnapshot: null,
          companyEntityVersionId: null,
          companyEntityNameSnapshot: null,
          companyEntityCreditCodeSnapshot: null,
          companyEntityRegisteredAddressSnapshot: null
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const values = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot.renderInput.values;
    expect(values["party.owner.name"]).toBe("结构化我方主体");
    expect(values["party.owner.name"]).not.toBe("建工智管建设有限公司");
  });

  it("blocks document queue and stales active documents when the selected company version drifts", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service, prisma } = makeService(tx);
    let committed = false;
    jest.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const result = await callback(tx as never);
      committed = true;
      return result as never;
    });

    await expect(service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    })).rejects.toThrow("所选我方公司主体资料已更新或不再可用");

    expect(committed).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(
      tx.$queryRaw.mock.calls.some(
        ([query]: [{ strings?: readonly string[] }]) =>
          (query.strings?.join(" ") ?? "").includes('FROM "CompanyEntity"')
      )
    ).toBe(true);
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
    expect(tx.contractGeneratedDocument.create).not.toHaveBeenCalled();
  });

  it("marks an existing successful document stale when list detects company drift", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await service.list("version-1", "owner-1");

    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
  });

  it("uses only the frozen company snapshot after submission and keeps legacy fallback historical", () => {
    const tx = makeTx();
    const { service } = makeService(tx);
    const renderer = service as unknown as {
      renderValues: (
        contract: { name: string; temporaryCode: string | null; code: string | null },
        version: Record<string, unknown>,
        parties: Array<{ roleKey: string; snapshot: Record<string, unknown> }>,
        bills: [],
        purpose: "draft"
      ) => Record<string, unknown>;
    };
    const contract = { name: "合同", temporaryCode: "草稿-1", code: null };
    const baseVersion = {
      status: "in_approval",
      amountCents: 1_000_000n,
      invoiceType: "vat_special",
      defaultTaxRatePercent: { toString: () => "13" },
      draftData: {
        companyEntitySelection: {
          id: "entity-current",
          versionId: "entity-version-current",
          versionNo: 9,
          name: "提交后漂移名称",
          unifiedSocialCreditCode: "91350211M000100Y46",
          registeredAddress: "新地址"
        }
      },
      clauseSnapshot: [],
      companyEntityIdSnapshot: "entity-frozen",
      companyEntityVersionId: "entity-version-3",
      companyEntityNameSnapshot: "冻结名称",
      companyEntityCreditCodeSnapshot: "91350211M000100Y46",
      companyEntityRegisteredAddressSnapshot: "冻结地址"
    };
    const parties = [{ roleKey: "party_a", snapshot: { name: "历史甲方" } }];

    const frozen = renderer.renderValues(contract, baseVersion, parties, [], "draft");
    expect(frozen["party.owner.name"]).toBe("冻结名称");

    const frozenDraft = renderer.renderValues(contract, {
      ...baseVersion,
      status: "draft",
      draftData: {}
    }, parties, [], "draft");
    expect(frozenDraft["party.owner.name"]).toBe("冻结名称");

    const historical = renderer.renderValues(contract, {
      ...baseVersion,
      draftData: {},
      companyEntityIdSnapshot: null,
      companyEntityVersionId: null,
      companyEntityNameSnapshot: null,
      companyEntityCreditCodeSnapshot: null,
      companyEntityRegisteredAddressSnapshot: null
    }, parties, [], "draft");
    expect(historical["party.owner.name"]).toBe("历史甲方");

    expect(() => renderer.renderValues(contract, {
      ...baseVersion,
      companyEntityIdSnapshot: null,
      companyEntityVersionId: null,
      companyEntityNameSnapshot: null,
      companyEntityCreditCodeSnapshot: null,
      companyEntityRegisteredAddressSnapshot: null
    }, parties, [], "draft")).toThrow("合同已提交但我方主体冻结快照缺失");
  });

  it("projects saved company-bound bank data only for the exact selected company version", () => {
    const { service } = makeService(makeTx());
    const renderer = service as unknown as { renderValues: (...args: unknown[]) => Record<string, unknown> };
    const binding = { protocolVersion: 1, companyEntityId: "company-a", companyEntityVersionNo: 3, companyEntityVersionId: "version-a", values: { openingBank: "虚构银行", bankAccount: "A-123", paymentBank: "", paymentAccount: "" } };
    const selection = { id: "company-a", versionId: "version-a", versionNo: 3, name: "虚构甲方", unifiedSocialCreditCode: "TEST", registeredAddress: "" };
    const version = { status: "draft", amountCents: 1n, invoiceType: null, defaultTaxRatePercent: null, draftData: { companyEntitySelection: selection, companyBankBinding: binding }, clauseSnapshot: [] };
    const oldParty = { roleKey: "party_a", snapshot: { name: "虚构甲方", bankAccount: "A-123" } };
    const contract = { name: "合同", temporaryCode: null, code: null };
    const result = renderer.renderValues(contract, version, [oldParty], [], "draft", [], undefined, true);
    expect(result["party.owner.bankAccount"]).toBe("A-123");
    expect(oldParty.snapshot.bankAccount).toBe("A-123");
    expect(() => renderer.renderValues(contract, { ...version, draftData: { ...version.draftData, companyEntitySelection: { ...selection, versionId: "other-version" } } }, [oldParty], [], "draft", [], undefined, true)).toThrow("核对");
  });

  it("queues v2 document output with canonical four-place amounts and unchanged content coordinates", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({ ...version, numericProtocolVersion: 2, amountYuan: new Prisma.Decimal("1.5340"), amountCents: 153n } as never);
    tx.contractBill.findMany.mockResolvedValue([{ id: "bill-1", billKey: "materials" }]);
    tx.contractBillRow.findMany.mockResolvedValue([{
      contractBillId: "bill-1", itemCode: null, itemName: "四位项目", specification: null, unit: "项",
      quantity: new Prisma.Decimal("1.2345"), unitPrice: new Prisma.Decimal("1.2345"), taxRate: null,
      numericProtocolVersion: 2, numericSource: "decimal_input", numericReviewStatus: "verified", precisionPolicy: "four_decimal",
      taxInclusiveAmountYuan: new Prisma.Decimal("1.5240"), taxExclusiveAmountYuan: null, taxAmountYuan: null,
      taxInclusiveAmountCents: null, taxExclusiveAmountCents: null, taxAmountCents: null, taxExclusiveUnitPrice: null,
      isProvisional: false, settlementBasis: null, customData: {}
    }] as never);
    const { service } = makeService(tx);
    await service.queue("version-1", "owner-1", { layoutTemplateVersionId: "layout-1", purpose: "draft" });
    const snapshot = tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot;
    expect(snapshot).toMatchObject(documentContentCoordinates);
    expect(snapshot.renderInput.values["contract.amount"]).toBe("1.5340");
    expect(snapshot.renderInput.values["bill.materials"][0]).toMatchObject({ unitPrice: "1.2345", taxInclusiveAmount: "1.5240", taxExclusiveAmount: "—", taxAmount: "—", taxRatePercent: "—" });
    expect(snapshot.renderInput.values["contract.amountUppercase"]).toBe("人民币壹元伍角叁分肆厘");
  });

  it("queues v2 sub-cent uppercase placeholders with the exact approved li/hao amount", async () => {
    const tx = makeTx(); const version = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({ ...version, numericProtocolVersion: 2, amountYuan: new Prisma.Decimal("1.5340"), amountCents: 153n } as never);
    const layout = await tx.contractLayoutTemplateVersion.findUnique();
    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({ ...layout, inspectionReport: { placeholders: ["合同金额大写"] } } as never);
    const { service } = makeService(tx);
    await service.queue("version-1", "owner-1", { layoutTemplateVersionId: "layout-1", purpose: "draft" });
    expect(tx.contractGeneratedDocument.create.mock.calls[0][0].data.inputSnapshot.renderInput.values).toMatchObject({ "contract.amount": "1.5340", "contract.amountUppercase": "人民币壹元伍角叁分肆厘" });
  });

  it("renders historical unknown tax and bill facts as dashes without recalculating amounts", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          draftRevision: 7,
          ...documentContentCoordinates,
          layoutTemplateVersionId: "layout-1",
          amountCents: 1_000_000n,
          invoiceType: null,
          defaultTaxRatePercent: null,
          draftData: {},
          clauseSnapshot: [],
          readinessSnapshot: { checkedRevision: 7, blocking: [], warnings: [] }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    tx.contractBill.findMany.mockResolvedValue([
      { id: "bill-1", billKey: "materials" }
    ]);
    tx.contractBillRow.findMany.mockResolvedValue([
      {
        contractBillId: "bill-1",
        itemCode: null,
        itemName: "历史未定价项目",
        specification: null,
        unit: "项",
        quantity: null,
        unitPrice: null,
        taxRate: null,
        taxInclusiveAmountCents: null,
        taxExclusiveAmountCents: null,
        taxAmountCents: null,
        isProvisional: false,
        settlementBasis: null,
        customData: {}
      }
    ]);
    const { service } = makeService(tx);

    await service.queue("version-1", "owner-1", {
      layoutTemplateVersionId: "layout-1",
      purpose: "draft"
    });

    const values = tx.contractGeneratedDocument.create.mock.calls[0][0].data
      .inputSnapshot.renderInput.values;
    expect(values).toMatchObject({
      "field.invoiceType": "—",
      "field.taxRatePercent": "—"
    });
    expect(values["bill.materials"][0]).toMatchObject({
      quantity: "—",
      unitPrice: "—",
      taxInclusiveUnitPrice: "—",
      taxExclusiveUnitPrice: "—",
      taxRatePercent: "—",
      taxInclusiveAmount: "—",
      taxExclusiveAmount: "—",
      taxAmount: "—"
    });
  });

  it("keeps the current upload-ordered document when an old mixed document is retried", async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: "current-document" });
    const tx = makeTx({
      contractGeneratedDocument: {
        ...makeTx().contractGeneratedDocument,
        findFirst
      }
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "old-document",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: {
        ...documentContentCoordinates,
        attachmentFiles: [
          { id: "attachment-a", originalName: "附件A.pdf", mimeType: "application/pdf" },
          { id: "attachment-b", originalName: "附件B.png", mimeType: "image/png" }
        ]
      }
    });
    await expect(makeService(tx).service.retry("old-document", "owner-1")).rejects.toThrow("当前文书已有按附件顺序生成的版本");
    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        contractVersionId: "version-1", purpose: "draft", status: "success",
        AND: [
          { inputSnapshot: { path: ["attachmentOrderVersion"], equals: "upload-ordered-mixed-attachments-v1" } },
          { inputSnapshot: { path: ["documentContentRevision"], equals: documentContentCoordinates.documentContentRevision } },
          { inputSnapshot: { path: ["documentContentFingerprint"], equals: documentContentCoordinates.documentContentFingerprint } }
        ]
      }),
      select: { id: true }
    });
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
  });

  it("marks failure retryable and records retry audit", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique
      .mockResolvedValueOnce({
        id: "document-1",
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        purpose: "draft",
        sourceRevision: 7,
        status: "failed",
        inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
      })
      .mockResolvedValueOnce({ id: "document-1", status: "queued" });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).resolves.toMatchObject({
      status: "queued"
    });
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "failed", sourceRevision: 7 },
      data: {
        status: "queued",
        errorMessage: null,
        startedAt: null,
        completedAt: null
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract.document.retry",
        metadata: documentContentCoordinates
      })
    );
  });

  it("retries a failed document after a metadata-only aggregate revision", async () => {
    const tx = makeTx();
    const currentVersion = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...currentVersion,
      draftRevision: 8
    });
    tx.contractGeneratedDocument.findUnique
      .mockResolvedValueOnce({
        id: "document-1",
        contractVersionId: "version-1",
        layoutTemplateVersionId: "layout-1",
        purpose: "draft",
        sourceRevision: 7,
        status: "failed",
        inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
      })
      .mockResolvedValueOnce({ id: "document-1", status: "queued" });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).resolves.toMatchObject({
      status: "queued"
    });
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenLastCalledWith({
      where: { id: "document-1", status: "failed", sourceRevision: 7 },
      data: expect.objectContaining({ status: "queued" })
    });
  });

  it("rejects retry when the frozen document content no longer matches", async () => {
    const tx = makeTx();
    const currentVersion = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...currentVersion,
      documentContentRevision: 4,
      documentContentFingerprint: "b".repeat(64)
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
    });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "该合同文档对应的文书内容已过期，请重新生成"
    );
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "queued" }) })
    );
  });

  it("rejects retry for a historical takeover without writes or audit", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "historical_takeover",
          draftRevision: 7,
          draftData: {}
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { attachmentFiles: [] }
    });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "历史接管工作台"
    );

    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("commits stale documents and denies retry when the selected company version drifts", async () => {
    const tx = makeTx({
      companyEntity: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entity-1",
          isActive: true,
          dataStatus: "complete",
          currentVersionNo: 4
        })
      },
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "original",
          draftRevision: 7,
          draftData: {
            companyEntitySelection: { id: "entity-1", versionNo: 3 }
          }
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { attachmentFiles: [] }
    });
    const { service, prisma } = makeService(tx);
    let committed = false;
    jest.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      const result = await callback(tx as never);
      committed = true;
      return result as never;
    });

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "所选我方公司主体资料已更新或不再可用"
    );

    expect(committed).toBe(true);
    expect(tx.contractGeneratedDocument.updateMany).toHaveBeenCalledWith({
      where: {
        contractVersionId: "version-1",
        status: { in: ["queued", "processing", "success"] }
      },
      data: { status: "stale" }
    });
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "queued" }) })
    );
    expect(tx.contractLayoutTemplateVersion.findUnique).not.toHaveBeenCalled();
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "contract.document.retry" })
    );
  });

  it("revalidates retry gates and attachment authorization in the transaction", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "internal_review",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: {
        ...documentContentCoordinates,
        attachmentFiles: [
          {
            id: "attachment-a",
            originalName: "附件A.pdf",
            mimeType: "application/pdf"
          }
        ]
      }
    });
    const { service } = makeService(tx);

    await service.retry("document-1", "owner-1");

    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(
      tx,
      "attachment-a",
      "owner-1"
    );
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        draftRevision: 7,
        status: { in: ["draft"] }
      },
      data: { draftRevision: { increment: 0 } }
    });
    expect(tx.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-1",
        ownerUserId: "owner-1",
        voidedAt: null
      },
      data: { ownerUserId: "owner-1" }
    });
  });

  it("rejects retry when the layout or version gate is no longer valid", async () => {
    const tx = makeTx();
    const failed = {
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: { ...documentContentCoordinates, attachmentFiles: [] }
    };
    tx.contractGeneratedDocument.findUnique.mockResolvedValue(failed);
    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      layoutTemplateId: "layout-template-1",
      status: "disabled"
    });
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "所选合同版式尚未发布，请重新选择已发布版式"
    );

    tx.contractLayoutTemplateVersion.findUnique.mockResolvedValue({
      id: "layout-1",
      layoutTemplateId: "layout-template-1",
      status: "published"
    });
    tx.contractVersion.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "合同文档状态已变化，请刷新后重试"
    );
    expect(tx.contractGeneratedDocument.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "queued" })
      })
    );
  });

  it("does not retry when attachment authorization has been revoked", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      layoutTemplateVersionId: "layout-1",
      purpose: "draft",
      sourceRevision: 7,
      status: "failed",
      inputSnapshot: {
        ...documentContentCoordinates,
        attachmentFiles: [{ id: "attachment-a" }]
      }
    });
    files.assertCanDownloadFile.mockRejectedValueOnce(
      new ForbiddenException("File access denied")
    );
    const { service } = makeService(tx);

    await expect(service.retry("document-1", "owner-1")).rejects.toThrow(
      "File access denied"
    );
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
  });

  it("lets the owner upload an offline revision for an editable draft version", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    const result = await service.uploadOfflineRevision("version-1", "owner-1", {
      fileId: "revision-file-1",
      label: "线下磋商稿",
      note: "按对方意见修订",
      confirmationStatementAccepted: true
    });

    expect(files.assertCanDownloadFile).toHaveBeenCalledWith(
      tx,
      "revision-file-1",
      "owner-1"
    );
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: {
        id: "version-1",
        draftRevision: 7,
        status: { in: ["draft"] }
      },
      data: { draftRevision: { increment: 0 } }
    });
    expect(tx.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: "contract-1",
        ownerUserId: "owner-1",
        voidedAt: null
      },
      data: { ownerUserId: "owner-1" }
    });
    expect(tx.contractOfflineRevision.create).toHaveBeenCalledWith({
      data: {
        contractVersionId: "version-1",
        sourceGeneratedDocumentId: null,
        fileId: "revision-file-1",
        label: "线下磋商稿",
        note: "按对方意见修订",
        confirmedByUserId: "owner-1"
      }
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "contract.document.offline_revision.confirm",
        businessType: "contract_offline_revision",
        businessId: "offline-revision-1",
        metadata: {
          contractVersionId: "version-1",
          fileId: "revision-file-1",
          sourceGeneratedDocumentId: null,
          newFileId: "revision-file-1",
          oldFileId: null,
          replacementKind: null
        }
      })
    );
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "offline-revision-1",
      fileId: "revision-file-1",
      label: "线下磋商稿"
    });
  });

  it("rejects offline revision upload for a historical takeover without writes or audit", async () => {
    const tx = makeTx({
      contractVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: "version-1",
          contractId: "contract-1",
          status: "draft",
          changeType: "historical_takeover",
          draftRevision: 7,
          draftData: {}
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("历史接管工作台");

    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contract.updateMany).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects offline revision upload from a non-owner through the owned version gate", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "other-user", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("只有合同经办人可以管理合同文档");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
  });

  it("does not create an offline revision when file authorization is revoked", async () => {
    const tx = makeTx();
    files.assertCanDownloadFile.mockRejectedValueOnce(
      new ForbiddenException("File access denied")
    );
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("File access denied");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
  });

  it("requires offline revision uploads to be DOCX documents", async () => {
    const tx = makeTx();
    files.assertCanDownloadFile.mockResolvedValueOnce({
      id: "revision-pdf",
      originalName: "线下修订稿.pdf",
      mimeType: "application/pdf"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-pdf",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("线下修订稿必须上传 DOCX 文档");
    expect(tx.contractVersion.updateMany).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
  });

  it("accepts DOCX offline revisions by filename when MIME is odd", async () => {
    const tx = makeTx();
    files.assertCanDownloadFile.mockResolvedValueOnce({
      id: "revision-file-odd-mime",
      originalName: "线下修订稿.DOCX",
      mimeType: "application/octet-stream"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-odd-mime",
        confirmationStatementAccepted: true
      })
    ).resolves.toMatchObject({ fileId: "revision-file-odd-mime" });
  });

  it("rejects offline revision upload when status gates race", async () => {
    const tx = makeTx();
    tx.contractVersion.updateMany.mockResolvedValueOnce({ count: 0 });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("合同草稿状态已变化，请刷新后重试");
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
  });

  it("rejects offline revision upload for non-editable contract versions", async () => {
    const tx = makeTx();
    const version = await tx.contractVersion.findUnique();
    tx.contractVersion.findUnique.mockResolvedValue({
      ...version,
      status: "in_approval"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("合同草稿当前不可编辑，不能生成或修订合同文档");
    expect(files.assertCanDownloadFile).not.toHaveBeenCalled();
  });

  it("requires the source generated document to belong to the same contract version", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-other",
      contractVersionId: "version-other"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-other",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow(
      "所选来源文档不属于当前合同版本"
    );
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("links a content-current generated DOCX after a metadata-only aggregate revision", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "success",
      sourceRevision: 6,
      inputSnapshot: documentContentCoordinates,
      docxFileId: "generated-docx-1"
    });
    const { service } = makeService(tx);

    await service.uploadOfflineRevision("version-1", "owner-1", {
      fileId: "revision-file-1",
      sourceGeneratedDocumentId: "document-1",
      confirmationStatementAccepted: true
    });

    expect(files.linkFileReplacement).toHaveBeenCalledWith(tx, {
      newFileId: "revision-file-1",
      oldFileId: "generated-docx-1",
      actorUserId: "owner-1"
    });
    expect(files.linkFileReplacement.mock.invocationCallOrder[0]).toBeLessThan(
      tx.contractOfflineRevision.create.mock.invocationCallOrder[0]
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        metadata: {
          contractVersionId: "version-1",
          fileId: "revision-file-1",
          sourceGeneratedDocumentId: "document-1",
          newFileId: "revision-file-1",
          oldFileId: "generated-docx-1",
          replacementKind: "contract_offline_revision_from_generated_docx"
        }
      })
    );
  });

  it.each([
    { status: "queued", docxFileId: "generated-docx-1", reason: "not successful" },
    { status: "success", docxFileId: null, reason: "missing DOCX" }
  ])("rejects a generated source that is $reason", async ({ status, docxFileId }) => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status,
      sourceRevision: 7,
      docxFileId
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("所选来源文档尚未生成成功或缺少 DOCX 文件");
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not create or audit an offline revision when replacement linking fails", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-1",
      contractVersionId: "version-1",
      status: "success",
      sourceRevision: 7,
      inputSnapshot: documentContentCoordinates,
      docxFileId: "generated-docx-1"
    });
    files.linkFileReplacement.mockRejectedValueOnce(
      new ForbiddenException("当前账号无权接入该文件替换链")
    );
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-1",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("当前账号无权接入该文件替换链");
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects a generated DOCX whose frozen document content changed", async () => {
    const tx = makeTx();
    tx.contractGeneratedDocument.findUnique.mockResolvedValue({
      id: "document-old-content",
      contractVersionId: "version-1",
      status: "success",
      sourceRevision: 7,
      inputSnapshot: {
        documentContentRevision: 2,
        documentContentFingerprint: "b".repeat(64)
      },
      docxFileId: "generated-docx-old"
    });
    const { service } = makeService(tx);

    await expect(
      service.uploadOfflineRevision("version-1", "owner-1", {
        fileId: "revision-file-1",
        sourceGeneratedDocumentId: "document-old-content",
        confirmationStatementAccepted: true
      })
    ).rejects.toThrow("所选来源文档已过期，请重新生成后再上传");
    expect(files.linkFileReplacement).not.toHaveBeenCalled();
    expect(tx.contractOfflineRevision.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("lists offline revisions newest first after the owned version gate", async () => {
    const tx = makeTx();
    const { service } = makeService(tx);

    await expect(service.listOfflineRevisions("version-1", "owner-1")).resolves.toEqual([
      { id: "revision-new", createdAt: new Date("2026-06-30T10:00:00.000Z") },
      { id: "revision-old", createdAt: new Date("2026-06-30T09:00:00.000Z") }
    ]);
    expect(tx.contractOfflineRevision.findMany).toHaveBeenCalledWith({
      where: { contractVersionId: "version-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  });
});
