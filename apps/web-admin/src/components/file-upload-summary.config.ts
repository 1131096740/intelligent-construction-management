export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${formatScaledSize(sizeBytes / 1024)} KB`;
  }

  return `${formatScaledSize(sizeBytes / 1024 / 1024)} MB`;
}

export function buildFileUploadSummary(
  selectedFile: File | null,
  busy: boolean,
  acceptText: string,
  limitText: string
): string {
  if (!selectedFile) {
    return `${busy ? "上传中" : "未选择文件"}。支持类型：${acceptText}；大小限制：${limitText}`;
  }

  return `${busy ? "上传中" : "已选择"}：${selectedFile.name}（${formatFileSize(
    selectedFile.size
  )}）。支持类型：${acceptText}；大小限制：${limitText}`;
}

function formatScaledSize(size: number): string {
  return Number.isInteger(size) ? `${size}` : size.toFixed(1);
}
