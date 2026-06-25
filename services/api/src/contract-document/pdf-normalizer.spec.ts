import {
  decodePDFRawStream,
  PageSizes,
  PDFArray,
  PDFDocument,
  PDFRawStream,
  rgb
} from "pdf-lib";
import { normalizeContractPdf } from "./pdf-normalizer";

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
  return PDFDocument.load(Uint8Array.from(buffer));
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
});
