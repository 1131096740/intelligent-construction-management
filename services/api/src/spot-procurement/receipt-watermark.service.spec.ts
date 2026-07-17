import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import sharpModule = require("sharp");
import {
  RECEIPT_WATERMARK_FONT_PATH,
  RECEIPT_WATERMARK_MAX_CARD_HEIGHT,
  RECEIPT_WATERMARK_MAX_OUTPUT_PIXELS,
  ReceiptWatermarkService,
  buildReceiptWatermarkMarkup,
  calculateReceiptWatermarkLayout,
  type ReceiptWatermarkInput
} from "./receipt-watermark.service";

const sharp = sharpModule as unknown as typeof import("sharp").default;

describe("ReceiptWatermarkService", () => {
  const baseInput = {
    mimeType: "image/png" as const,
    projectLabel: "天府新区道路工程",
    procurementCode: "LXCG-2026-0001",
    uploaderName: "张三",
    uploadedAt: new Date("2026-07-17T08:09:10.000Z"),
    source: "camera" as const,
    note: "免烧砖",
    category: "material_scene" as const
  };

  async function createPng(): Promise<Buffer> {
    return sharp({
      create: {
        width: 360,
        height: 240,
        channels: 3,
        background: "#e11d48"
      }
    })
      .png()
      .toBuffer();
  }

  it("extends the image with a bottom information card without covering the subject", async () => {
    const originalBuffer = await createPng();
    const result = await new ReceiptWatermarkService().generate({
      ...baseInput,
      originalBuffer
    });
    const outputMetadata = await sharp(result.buffer).metadata();
    const originalPixels = await sharp(originalBuffer)
      .removeAlpha()
      .raw()
      .toBuffer();
    const subjectPixels = await sharp(result.buffer)
      .extract({ left: 0, top: 0, width: 360, height: 240 })
      .removeAlpha()
      .raw()
      .toBuffer();
    const cardStats = await sharp(result.buffer)
      .extract({
        left: 0,
        top: 240,
        width: 360,
        height: result.height - 240
      })
      .stats();

    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(360);
    expect(result.height).toBeGreaterThan(240);
    expect(outputMetadata).toMatchObject({
      format: "png",
      width: 360,
      height: result.height
    });
    expect(subjectPixels).toEqual(originalPixels);
    expect(cardStats.isOpaque).toBe(true);
    expect(cardStats.channels.some((channel) => channel.stdev > 0)).toBe(true);
    expect(result.originalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.watermarkedSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.watermarkedSha256).not.toBe(result.originalSha256);
    expect(result.originalSha256).toBe(
      createHash("sha256").update(originalBuffer).digest("hex")
    );
    expect(result.watermarkedSha256).toBe(
      createHash("sha256").update(result.buffer).digest("hex")
    );
  });

  it("keeps JPEG input as JPEG output", async () => {
    const originalBuffer = await sharp({
      create: {
        width: 480,
        height: 320,
        channels: 3,
        background: "#2563eb"
      }
    })
      .jpeg()
      .toBuffer();

    const result = await new ReceiptWatermarkService().generate({
      ...baseInput,
      originalBuffer,
      mimeType: "image/jpeg",
      source: "album",
      category: "delivery_note"
    });

    expect(result.mimeType).toBe("image/jpeg");
    await expect(sharp(result.buffer).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 480,
      height: result.height
    });
  });

  it.each([
    ["camera", "系统拍照"],
    ["album", "相册上传"]
  ] as const)("renders source %s as %s", (source, expectedLabel) => {
    const markup = buildReceiptWatermarkMarkup({
      ...baseInput,
      originalBuffer: Buffer.from("not-rendered"),
      source
    });

    expect(markup).toContain("天府新区道路工程");
    expect(markup).toContain("LXCG-2026-0001");
    expect(markup).toContain("张三");
    expect(markup).toContain("2026-07-17 16:09:10");
    expect(markup).toContain(expectedLabel);
    expect(markup).toContain("免烧砖");
    expect(markup).toContain("材料/卸货现场照片");
  });

  it.each([
    ["material_scene", "材料/卸货现场照片"],
    ["delivery_note", "乙方送货单"]
  ] as const)("renders category %s as %s", (category, expectedLabel) => {
    const markup = buildReceiptWatermarkMarkup({
      ...baseInput,
      originalBuffer: Buffer.from("not-rendered"),
      category
    });

    expect(markup).toContain(expectedLabel);
  });

  it("auto-orients phone photos before appending the card", async () => {
    const originalBuffer = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: "#7c3aed"
      }
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await new ReceiptWatermarkService().generate({
      ...baseInput,
      originalBuffer,
      mimeType: "image/jpeg"
    });
    const metadata = await sharp(result.buffer).metadata();

    expect(result.width).toBe(400);
    expect(result.height).toBeGreaterThan(800);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("keeps watermark text readable when a common phone photo is scaled to preview width", () => {
    const originalWidth = 4_032;
    const previewWidth = 360;
    const layout = calculateReceiptWatermarkLayout(originalWidth);
    const previewFontSize =
      (layout.fontSize * previewWidth) / originalWidth;

    expect(previewFontSize).toBeGreaterThanOrEqual(10);
    expect(layout.padding * (previewWidth / originalWidth)).toBeGreaterThan(10);
    expect(layout.accentWidth * (previewWidth / originalWidth)).toBeGreaterThan(
      3
    );
  });

  it("keeps a short watermark within the declared 50 MP landscape boundary", async () => {
    const imageWidth = 8_192;
    const imageHeight = 6_000;
    const layout = calculateReceiptWatermarkLayout(imageWidth);
    const text = await sharp({
      text: {
        text: buildReceiptWatermarkMarkup(
          {
            ...baseInput,
            originalBuffer: Buffer.from("not-rendered"),
            projectLabel: "项目",
            procurementCode: "LXCG-1",
            uploaderName: "张三",
            note: "短备注"
          },
          layout.fontSize
        ),
        font: "Noto Sans SC",
        fontfile: RECEIPT_WATERMARK_FONT_PATH,
        width: layout.textWidth,
        align: "left",
        rgba: true,
        spacing: Math.round(layout.fontSize * 0.35),
        wrap: "word-char"
      }
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    const cardHeight = text.info.height + layout.padding * 2;

    expect(cardHeight).toBeLessThanOrEqual(
      RECEIPT_WATERMARK_MAX_CARD_HEIGHT
    );
    expect(imageWidth * (imageHeight + cardHeight)).toBeLessThanOrEqual(
      RECEIPT_WATERMARK_MAX_OUTPUT_PIXELS
    );
  });

  it("escapes user text before it enters Pango markup", () => {
    const markup = buildReceiptWatermarkMarkup({
      ...baseInput,
      originalBuffer: Buffer.from("not-rendered"),
      projectLabel: 'A&B <script>"quoted"</script>',
      note: "砖<>&\"'"
    });

    expect(markup).toContain(
      "A&amp;B &lt;script&gt;&quot;quoted&quot;&lt;/script&gt;"
    );
    expect(markup).toContain("砖&lt;&gt;&amp;&quot;&apos;");
    expect(markup).not.toContain("<script>");
  });

  it("uses the repository font through an absolute font file path", async () => {
    expect(isAbsolute(RECEIPT_WATERMARK_FONT_PATH)).toBe(true);
    await expect(access(RECEIPT_WATERMARK_FONT_PATH)).resolves.toBeUndefined();
  });

  it.each([undefined, " \n "])(
    "keeps the fixed note label when no note was entered",
    (note) => {
      const markup = buildReceiptWatermarkMarkup({
        ...baseInput,
        originalBuffer: Buffer.from("not-rendered"),
        note
      });

      expect(markup).toContain("备注：无");
    }
  );

  it("rejects latitude and longitude instead of recording location data", async () => {
    const originalBuffer = await createPng();
    const input = {
      ...baseInput,
      originalBuffer,
      latitude: 30.5728,
      longitude: 104.0668
    } as ReceiptWatermarkInput;

    await expect(new ReceiptWatermarkService().generate(input)).rejects.toThrow(
      "收货照片水印参数不合法"
    );
  });

  it.each([
    {
      name: "unsupported MIME",
      input: { mimeType: "application/pdf", originalBuffer: Buffer.from("%PDF") }
    },
    {
      name: "damaged image",
      input: {
        mimeType: "image/png",
        originalBuffer: Buffer.from("damaged-png")
      }
    }
  ])("rejects $name with a fixed Chinese error", async ({ input }) => {
    await expect(
      new ReceiptWatermarkService().generate({
        ...baseInput,
        ...input
      } as ReceiptWatermarkInput)
    ).rejects.toThrow("收货照片必须是有效的 JPEG 或 PNG 图片");
  });

  it("rejects a MIME type that does not match the real image format", async () => {
    await expect(
      new ReceiptWatermarkService().generate({
        ...baseInput,
        originalBuffer: await createPng(),
        mimeType: "image/jpeg"
      })
    ).rejects.toThrow("收货照片类型与文件内容不一致");
  });

  it("rejects a tiny but otherwise valid image before rendering", async () => {
    const originalBuffer = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: "#0f766e"
      }
    })
      .png()
      .toBuffer();

    await expect(
      new ReceiptWatermarkService().generate({
        ...baseInput,
        originalBuffer
      })
    ).rejects.toThrow("收货照片尺寸不符合要求");
  });

  it("rejects a fully transparent PNG as empty receipt evidence", async () => {
    const originalBuffer = await sharp({
      create: {
        width: 360,
        height: 240,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    await expect(
      new ReceiptWatermarkService().generate({
        ...baseInput,
        originalBuffer
      })
    ).rejects.toThrow("收货照片必须是有效的 JPEG 或 PNG 图片");
  });

  it("rejects an overlong note before text rendering", async () => {
    await expect(
      new ReceiptWatermarkService().generate({
        ...baseInput,
        originalBuffer: await createPng(),
        note: "砖".repeat(501)
      })
    ).rejects.toThrow("收货照片水印文字过长");
  });

  it.each(["a\u0000b", "abc\u202e123", "x\ufdd0"])(
    "rejects unsafe markup control text before native rendering",
    async (note) => {
      await expect(
        new ReceiptWatermarkService().generate({
          ...baseInput,
          originalBuffer: await createPng(),
          note
        })
      ).rejects.toThrow("收货照片水印参数不合法");
    }
  );

  it("classifies a decodable header with damaged pixels as an invalid image", async () => {
    const complete = await sharp({
      create: {
        width: 480,
        height: 320,
        channels: 3,
        background: "#f59e0b"
      }
    })
      .jpeg()
      .toBuffer();
    const damaged = complete.subarray(0, Math.floor(complete.length * 0.7));
    await expect(
      sharp(damaged, { failOn: "warning" }).metadata()
    ).resolves.toMatchObject({ format: "jpeg" });

    await expect(
      new ReceiptWatermarkService().generate({
        ...baseInput,
        originalBuffer: damaged,
        mimeType: "image/jpeg"
      })
    ).rejects.toThrow("收货照片必须是有效的 JPEG 或 PNG 图片");
  });

  it("hides image processor details behind a fixed generation error", async () => {
    const service = new ReceiptWatermarkService();
    jest
      .spyOn(
        service as unknown as {
          renderWatermarkedBuffer: () => Promise<never>;
        },
        "renderWatermarkedBuffer"
      )
      .mockRejectedValue(new Error("libvips internal detail"));

    await expect(
      service.generate({
        ...baseInput,
        originalBuffer: await createPng()
      })
    ).rejects.toThrow("收货照片水印生成失败，请重新上传");
  });
});
