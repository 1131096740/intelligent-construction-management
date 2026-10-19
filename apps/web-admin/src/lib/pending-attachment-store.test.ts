import { describe, expect, it } from "vitest";
import { identicalAttachmentBytes } from "./pending-attachment-store";
describe("attachment identity", () => {
  it("compares original content, including the complete end of a large photograph", () => {
    const a = new Uint8Array(20 * 1024 * 1024 - 1);
    const b = a.slice();
    expect(identicalAttachmentBytes(a.buffer, b.buffer)).toBe(true);
    b[b.length - 1] = 7;
    expect(identicalAttachmentBytes(a.buffer, b.buffer)).toBe(false);
    expect(identicalAttachmentBytes(a.buffer, b.slice(0, -1).buffer)).toBe(false);
  });
});
