export interface OfficialDocumentScope {
  profile: string;
  kind: "QUALIFICATION_ONLY" | "OFFICIAL_TOOL_RUNTIME";
  lockName: string;
  lockSha256: string;
  manifestPath: string;
  manifestSha256: string;
  temporaryDirectory: string;
  libreOfficeCommand: string;
  libreOfficeEnv: NodeJS.ProcessEnv;
  check(): void;
  checkMaterials(): void;
  remainingTotalMilliseconds(): number;
}
export function currentOfficialDocumentScope(): OfficialDocumentScope | undefined;
