import { prepareSeedLayoutDocxSource, SEED_LAYOUT_FONT } from "../contract-document/seed-layout-docx-source";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { coreFlowSeedData } from "./core-flow-seed-data";
import { renderLayoutPreviewDocx } from "../contract-document/layout-preview-docx";
import { layoutPreviewValues } from "../contract-document/layout-preview-values";
import { requiredPlaceholderKeys, declaredBillKeys } from "../contract-document/contract-document.service";

const requireLocal = createRequire(__filename);
function initializer() {
  const convert = jest.fn().mockResolvedValue(Buffer.from("real-converter-result"));
  const module = { exports: {} as { initializeSeedLayout: (args: unknown) => Promise<unknown> } };
  runInNewContext(readFileSync(join(__dirname, "../../prisma/seed-layout-preview.cjs"), "utf8"), {
    module, Buffer,
    require: (name: string) => {
      if (name.endsWith("seed-layout-docx-source")) return { prepareSeedLayoutDocxSource, SEED_LAYOUT_FONT };
      if (name.endsWith("layout-preview-docx")) return { renderLayoutPreviewDocx };
      if (name.endsWith("libreoffice-converter")) return { convertDocxToPdf: convert };
      if (name.endsWith("layout-preview-values")) return { layoutPreviewValues };
      if (name.endsWith("contract-document.service")) return { requiredPlaceholderKeys, declaredBillKeys };
      return requireLocal(name);
    }
  });
  const prisma = {
    contractLayoutTemplateVersion: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    contractLayoutTemplate: { upsert: jest.fn() },
    contractLayoutPreviewJob: { create: jest.fn() },
    fileObject: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() }
  };
  const writeFile = jest.fn().mockResolvedValue({ sizeBytes: 21, contentSha256: "a".repeat(64) });
  return { initialize: module.exports.initializeSeedLayout, prisma, writeFile, convert };
}
const samples = [coreFlowSeedData.materialPurchaseWorkbench, coreFlowSeedData.equipmentRentalWorkbench,
  coreFlowSeedData.laborSubcontractWorkbench, coreFlowSeedData.genericContractWorkbench];
describe("版式初始化保留原件和 V1", () => {
  it.each(samples)("$layout.name 使用对应 DOCX 和真实样张输入", async (data) => {
    const f = initializer();
    await f.initialize({ ...f, data, uploaderId: "uploader", sourcePath: join(__dirname, "../../assets/templates", data.layout.docxFile.originalName) });
    expect(f.convert).toHaveBeenCalledTimes(1);
    expect(f.writeFile).toHaveBeenNthCalledWith(2, data.layout.previewPdfFile, Buffer.from("real-converter-result"));
    expect(f.prisma.contractLayoutTemplateVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: data.layout.versionId, previewPdfFileId: data.layout.previewPdfFile.id })
    }));
  });
  it("已有 V1 或后续版本时不读写对象、不改版本或历史任务", async () => {
    const f = initializer();
    f.prisma.contractLayoutTemplateVersion.findFirst.mockResolvedValue({ id: "existing-v1" } as never);
    await expect(f.initialize({ ...f, data: samples[0], sourcePath: "/must-not-read" })).resolves.toEqual({ status: "preserved" });
    expect(f.writeFile).not.toHaveBeenCalled();
    expect(f.convert).not.toHaveBeenCalled();
    expect(f.prisma.fileObject.create).not.toHaveBeenCalled();
    expect(f.prisma.contractLayoutTemplateVersion.create).not.toHaveBeenCalled();
    expect(f.prisma.contractLayoutPreviewJob.create).not.toHaveBeenCalled();
  });
  it("孤立既有文件拒绝覆盖，须人工核对", async () => {
    const f = initializer();
    f.prisma.fileObject.findFirst.mockResolvedValue({ id: "existing-original" } as never);
    await expect(f.initialize({ ...f, data: samples[0], sourcePath: "/must-not-read" })).rejects.toThrow("禁止覆盖原件");
    expect(f.writeFile).not.toHaveBeenCalled();
  });
});
