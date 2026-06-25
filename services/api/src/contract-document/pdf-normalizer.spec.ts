import {
  decodePDFRawStream,
  degrees,
  PageSizes,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  rgb
} from "pdf-lib";
import {
  MAX_IMAGE_PIXELS,
  MAX_TOTAL_INPUT_BYTES,
  MAX_TOTAL_PAGES,
  normalizeContractPdf
} from "./pdf-normalizer";

const [A4_WIDTH, A4_HEIGHT] = PageSizes.A4;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
  "base64"
);
const JPEG = Buffer.from(
  "/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==",
  "base64"
);

async function createPdf(pageSizes: Array<[number, number]>): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (const [width, height] of pageSizes) {
    const page = document.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.2, 0.4, 0.8) });
  }
  return Buffer.from(await document.save());
}

async function loadOutput(buffer: Buffer): Promise<PDFDocument> {
  return PDFDocument.load(buffer);
}

function pageContent(document: PDFDocument, pageIndex: number): string {
  const contents = document.getPage(pageIndex).node.Contents();
  const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
  return entries
    .map((entry) => document.context.lookup(entry))
    .filter((stream): stream is PDFRawStream => stream instanceof PDFRawStream)
    .map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString())
    .join("\n");
}

function matrices(content: string): number[][] {
  return [...content.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) cm/g)].map(
    (match) => match.slice(1).map(Number)
  );
}

function embeddedFormBoxes(document: PDFDocument): number[][] {
  return document.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .filter(
      (object): object is PDFRawStream =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Form")
    )
    .map((stream) =>
      stream.dict
        .lookup(PDFName.of("BBox"), PDFArray)
        .asArray()
        .map((value) => (value as PDFNumber).asNumber())
    );
}

async function createCroppedRotatedPdf(
  cropBox: { x: number; y: number; width: number; height: number },
  rotation: 0 | 90 | 270
): Promise<Buffer> {
  const document = await PDFDocument.create();
  const page = document.addPage([1000, 1000]);
  page.drawRectangle({ x: 0, y: 0, width: 1000, height: 1000, color: rgb(1, 0, 0) });
  page.drawRectangle({ ...cropBox, color: rgb(0, 0.8, 0.2) });
  page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
  page.setRotation(degrees(rotation));
  return Buffer.from(await document.save());
}

describe("contract PDF A4 normalizer", () => {
  it("keeps A4 portrait pages portrait within point tolerance", async () => {
    const result = await normalizeContractPdf(
      await createPdf([[A4_WIDTH + 0.5, A4_HEIGHT - 0.5]]),
      []
    );
    const output = await loadOutput(result.buffer);

    expect(output.getPage(0).getSize()).toEqual({
      width: A4_WIDTH,
      height: A4_HEIGHT
    });
    expect(result.pageSizes).toEqual(["A4_portrait"]);
  });

  it("keeps A4 landscape bill pages landscape after the contract", async () => {
    const result = await normalizeContractPdf(
      await createPdf([[A4_WIDTH, A4_HEIGHT]]),
      [
        {
          name: "工程量清单.pdf",
          type: "pdf",
          buffer: await createPdf([[A4_HEIGHT, A4_WIDTH]])
        }
      ]
    );
    const output = await loadOutput(result.buffer);

    expect(output.getPage(0).getSize()).toEqual({
      width: A4_WIDTH,
      height: A4_HEIGHT
    });
    expect(output.getPage(1).getSize()).toEqual({
      width: A4_HEIGHT,
      height: A4_WIDTH
    });
    expect(result.pageSizes).toEqual(["A4_portrait", "A4_landscape"]);
  });

  it("scales an external PDF page onto A4 without cropping", async () => {
    const result = await normalizeContractPdf(
      await createPdf([[A4_WIDTH, A4_HEIGHT]]),
      [{ name: "wide.pdf", buffer: await createPdf([[1000, 500]]) }]
    );
    const output = await loadOutput(result.buffer);
    const pageMatrices = matrices(pageContent(output, 1));
    const scale = A4_HEIGHT / 1000;
    const drawScale = pageMatrices.find(
      ([a, b, c, d]) =>
        Math.abs(a - scale) < 0.001 && b === 0 && c === 0 && Math.abs(d - scale) < 0.001
    );
    const translation = pageMatrices.find(
      ([a, b, c, d, x, y]) =>
        a === 1 &&
        b === 0 &&
        c === 0 &&
        d === 1 &&
        Math.abs(x) < 0.01 &&
        Math.abs(y - (A4_WIDTH - 500 * scale) / 2) < 0.01
    );

    expect(output.getPage(1).getSize()).toEqual({
      width: A4_HEIGHT,
      height: A4_WIDTH
    });
    expect(drawScale).toBeDefined();
    expect(translation).toBeDefined();
    expect(500 * scale).toBeLessThan(A4_WIDTH);
  });

  it.each([
    [90, "A4_landscape", A4_HEIGHT, A4_WIDTH, [0, -1, 1, 0]],
    [270, "A4_portrait", A4_WIDTH, A4_HEIGHT, [0, 1, -1, 0]]
  ] as const)(
    "normalizes a %d-degree rotated page using its visible orientation",
    async (rotation, pageSize, width, height, rotationMatrix) => {
      const source =
        rotation === 90
          ? await createCroppedRotatedPdf(
              { x: 0, y: 0, width: 300, height: 500 },
              rotation
            )
          : await createCroppedRotatedPdf(
              { x: 0, y: 0, width: 500, height: 300 },
              rotation
            );
      const result = await normalizeContractPdf(source, []);
      const output = await loadOutput(result.buffer);

      expect(output.getPage(0).getSize()).toEqual({ width, height });
      expect(result.pageSizes).toEqual([pageSize]);
      expect(
        matrices(pageContent(output, 0)).some((matrix) =>
          rotationMatrix.every(
            (value, index) => Math.abs(matrix[index] - value) < 0.000001
          )
        )
      ).toBe(true);
    }
  );

  it("clips to an offset CropBox before scaling and centering", async () => {
    const result = await normalizeContractPdf(
      await createCroppedRotatedPdf(
        { x: 120, y: 240, width: 300, height: 600 },
        0
      ),
      []
    );
    const output = await loadOutput(result.buffer);

    expect(output.getPage(0).getSize()).toEqual({
      width: A4_WIDTH,
      height: A4_HEIGHT
    });
    expect(embeddedFormBoxes(output)).toContainEqual([120, 240, 420, 840]);
    expect(matrices(pageContent(output, 0))).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          A4_HEIGHT / 600,
          0,
          0,
          A4_HEIGHT / 600
        ])
      ])
    );
  });

  it("converts PNG and JPEG attachments into centered A4 pages", async () => {
    const result = await normalizeContractPdf(
      await createPdf([[A4_WIDTH, A4_HEIGHT]]),
      [
        { name: "现场照片.png", type: "png", buffer: PNG },
        { name: "签收单.jpg", buffer: JPEG }
      ]
    );
    const output = await loadOutput(result.buffer);

    for (const pageIndex of [1, 2]) {
      const pageMatrices = matrices(pageContent(output, pageIndex));
      expect(
        pageMatrices.some(
          ([a, b, c, d]) =>
            Math.abs(a - A4_WIDTH) < 0.01 &&
            b === 0 &&
            c === 0 &&
            Math.abs(d - A4_WIDTH) < 0.01
        )
      ).toBe(true);
      expect(
        pageMatrices.some(
          ([a, b, c, d, x, y]) =>
            a === 1 &&
            b === 0 &&
            c === 0 &&
            d === 1 &&
            Math.abs(x) < 0.01 &&
            Math.abs(y - (A4_HEIGHT - A4_WIDTH) / 2) < 0.01
        )
      ).toBe(true);
    }
  });

  it("returns inspection metadata and contextual attachment errors", async () => {
    const result = await normalizeContractPdf(
      await createPdf([
        [A4_WIDTH, A4_HEIGHT],
        [A4_HEIGHT, A4_WIDTH]
      ]),
      [{ name: "photo.png", buffer: PNG }]
    );

    expect(result).toMatchObject({
      pageCount: 3,
      warnings: [],
      pageSizes: ["A4_portrait", "A4_landscape", "A4_portrait"]
    });
    await expect(
      normalizeContractPdf(await createPdf([[A4_WIDTH, A4_HEIGHT]]), [
        { name: "notes.txt", buffer: Buffer.from("plain text") }
      ])
    ).rejects.toThrow('Attachment 1 ("notes.txt") has an unsupported file type');
    await expect(
      normalizeContractPdf(await createPdf([[A4_WIDTH, A4_HEIGHT]]), [
        { name: "ok.png", buffer: PNG },
        { name: "broken.pdf", type: "pdf", buffer: Buffer.from("%PDF-broken") }
      ])
    ).rejects.toThrow('Failed to process attachment 2 ("broken.pdf")');
  });

  it("rejects total bytes, page count, and image pixels over resource limits", async () => {
    const contract = await createPdf([[A4_WIDTH, A4_HEIGHT]]);
    const repeatedBuffer = Buffer.alloc(1024 * 1024);
    const oversizedAttachments = Array.from(
      { length: Math.floor(MAX_TOTAL_INPUT_BYTES / repeatedBuffer.length) + 1 },
      (_, index) => ({
        name: `chunk-${index}.pdf`,
        type: "pdf" as const,
        buffer: repeatedBuffer
      })
    );
    await expect(
      normalizeContractPdf(contract, oversizedAttachments)
    ).rejects.toThrow(
      `Total PDF normalization input exceeds ${MAX_TOTAL_INPUT_BYTES} bytes`
    );

    await expect(
      normalizeContractPdf(
        contract,
        [
          {
            name: "too-many-pages.pdf",
            type: "pdf",
            buffer: await createPdf(
              Array.from({ length: MAX_TOTAL_PAGES }, () => [1, 1])
            )
          }
        ]
      )
    ).rejects.toThrow(
      `PDF normalization exceeds ${MAX_TOTAL_PAGES} total pages while processing Attachment 1 ("too-many-pages.pdf")`
    );

    const oversizedPng = Buffer.alloc(24);
    PNG.copy(oversizedPng, 0, 0, 16);
    oversizedPng.writeUInt32BE(MAX_IMAGE_PIXELS + 1, 16);
    oversizedPng.writeUInt32BE(1, 20);
    await expect(
      normalizeContractPdf(contract, [
        { name: "huge.png", type: "png", buffer: oversizedPng }
      ])
    ).rejects.toThrow(
      `Attachment 1 ("huge.png") exceeds ${MAX_IMAGE_PIXELS} image pixels`
    );
  });
});
