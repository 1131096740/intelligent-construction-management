import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream
} from "pdf-lib";
import {
  renderSpotProcurementApprovalForm,
  SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY
} from "./spot-procurement-form-renderer";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=",
  "base64"
);

function imageDrawCount(document: PDFDocument): number {
  return document.getPages().reduce((count, page) => {
    const contents = page.node.Contents();
    const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
    const content = entries
      .map((entry) => document.context.lookup(entry))
      .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
      .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString())
      .join("\n");
    return count + (content.match(/\/I\d+\s+Do/g)?.length ?? 0);
  }, 0);
}

function embeddedImageCount(document: PDFDocument): number {
  return document.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
    ).length;
}

describe("spot procurement approval form renderer", () => {
  it("renders the original A4 portrait procurement application without payment facts", async () => {
    const buffer = await renderSpotProcurementApprovalForm({
      kind: "application",
      projectName: "昆明市防洪排涝治理工程",
      procurementCode: "LXCG-20260718-001",
      applicationDepartment: "工程部",
      applicationName: "杨帅",
      purchaserDepartment: "物资部",
      purchaserName: "杨帅",
      requestedArrivalAt: new Date("2026-07-18T00:00:00.000Z"),
      reason: "新运粮河施工急需零星材料",
      lines: Array.from({ length: 10 }, (_, index) => ({
        materialName: `材料 ${index + 1}`,
        specification: "DN100",
        unit: "米",
        quantity: "12",
        note: "现场使用"
      })),
      signatures: {
        materialDirector: {
          name: "张齐",
          signedAt: new Date("2026-07-18"),
          signature: PNG_1X1
        },
        projectManager: {
          name: "马利江",
          signedAt: new Date("2026-07-18"),
          signature: PNG_1X1
        }
      },
      watermark: ["建工智管", "下载人：杨帅"]
    });

    const document = await PDFDocument.load(buffer);
    const firstPage = document.getPage(0);

    expect(SPOT_PROCUREMENT_APPROVAL_ORIGINAL_TEMPLATE_KEY).toBe(
      "spot_procurement_approval_original_v1"
    );
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(document.getPageCount()).toBe(2);
    expect(firstPage.getWidth()).toBeCloseTo(595.28, 1);
    expect(firstPage.getHeight()).toBeCloseTo(841.89, 1);
    expect(imageDrawCount(document)).toBe(2);
    expect(embeddedImageCount(document)).toBeGreaterThanOrEqual(2);
  });

  it("renders the original A5 landscape payment application inside one A5 page", async () => {
    const buffer = await renderSpotProcurementApprovalForm({
      kind: "payment",
      projectName: "昆明市防洪排涝治理工程",
      paymentCode: "LXCG-20260718-001-V1-P001",
      submittedAt: new Date("2026-07-18T00:00:00.000Z"),
      payerCompanyName: "四川建工智管建筑工程有限公司",
      reason: "新运粮河施工急需零星材料",
      amountCents: 440000n,
      paymentTypeLabel: "公司直付",
      paymentMethodLabel: "网银转账",
      primaryPaymentChannel: "网银转账；户名：利民建材店；账号：6222****1234；开户行：建设银行",
      handlerName: "杨帅",
      signatures: {
        comprehensiveDirector: {
          name: "杨颖",
          signedAt: new Date("2026-07-18"),
          signature: PNG_1X1
        },
        projectManager: {
          name: "马利江",
          signedAt: new Date("2026-07-18"),
          signature: PNG_1X1
        },
        financeDirector: {
          name: "桂丽",
          signedAt: new Date("2026-07-18"),
          signature: PNG_1X1
        },
        finalApprover: {
          name: "杨济旭",
          signedAt: new Date("2026-07-18"),
          signature: PNG_1X1
        }
      }
    });

    const document = await PDFDocument.load(buffer);
    const firstPage = document.getPage(0);

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(document.getPageCount()).toBe(1);
    expect(firstPage.getWidth()).toBeCloseTo(595.28, 1);
    expect(firstPage.getHeight()).toBeCloseTo(419.53, 1);
    expect(imageDrawCount(document)).toBe(4);
    expect(embeddedImageCount(document)).toBeGreaterThanOrEqual(4);
  });

  it("fails closed instead of emitting a formal A5 when a frozen signature image cannot be decoded", async () => {
    const emptySignature = {
      name: null,
      signedAt: null,
      signature: null
    };

    await expect(
      renderSpotProcurementApprovalForm({
        kind: "payment",
        projectName: "昆明市防洪排涝治理工程",
        paymentCode: "LXCG-20260718-001-V1-P001",
        submittedAt: new Date("2026-07-18T00:00:00.000Z"),
        payerCompanyName: "四川建工智管建筑工程有限公司",
        reason: "新运粮河施工急需零星材料",
        amountCents: 440000n,
        paymentTypeLabel: "公司直付",
        paymentMethodLabel: "网银转账",
        primaryPaymentChannel: "网银转账；户名：利民建材店",
        handlerName: "杨帅",
        signatures: {
          comprehensiveDirector: {
            name: "杨颖",
            signedAt: new Date("2026-07-18"),
            signature: Buffer.from("not-an-image")
          },
          projectManager: emptySignature,
          financeDirector: emptySignature,
          finalApprover: emptySignature
        }
      })
    ).rejects.toThrow();
  });
});
