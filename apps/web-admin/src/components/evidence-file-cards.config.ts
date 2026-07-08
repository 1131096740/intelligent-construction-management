export type EvidenceFileTagTheme = "default" | "success" | "warning";

export interface EvidenceFileCardState {
  statusLabel: string;
  canDownload: boolean;
  disabledReason?: string | null;
  auditHint?: string;
}

export interface EvidenceFileCardView {
  statusTheme: EvidenceFileTagTheme;
  downloadText: string;
  downloadTheme: EvidenceFileTagTheme;
  auditHint: string;
  disabledReason: string;
}

export function toEvidenceFileCardView(file: EvidenceFileCardState): EvidenceFileCardView {
  return {
    statusTheme: evidenceStatusTheme(file.statusLabel),
    downloadText: file.canDownload ? "可授权下载" : "暂不可下载",
    downloadTheme: file.canDownload ? "success" : "warning",
    auditHint: file.auditHint ?? "下载将记录审计",
    disabledReason: file.canDownload ? "" : file.disabledReason ?? "暂不可下载"
  };
}

function evidenceStatusTheme(statusLabel: string): EvidenceFileTagTheme {
  if (statusLabel.includes("待")) return "warning";
  if (statusLabel.includes("已")) return "success";
  return "default";
}
