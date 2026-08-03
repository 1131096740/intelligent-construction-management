export interface MemoryUploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function normalizeUploadedOriginalName(originalName: string) {
  const decoded = Buffer.from(originalName, "latin1").toString("utf8");
  const looksLikeMojibake = /[\u00c0-\u00ff]/.test(originalName);
  const decodedToChinese = /[\u4e00-\u9fff]/.test(decoded);
  const alreadyChinese = /[\u4e00-\u9fff]/.test(originalName);

  if (
    looksLikeMojibake &&
    decodedToChinese &&
    !alreadyChinese &&
    !decoded.includes("\uFFFD")
  ) {
    return decoded;
  }
  return originalName;
}
