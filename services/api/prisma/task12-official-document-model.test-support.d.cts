/** Model-only FS/Git/hash boundaries, not a physical qualification result. */
export function model(options?: { jdkLink?: boolean; profile?: "TASK12_OFFICIAL_TEMURIN17_0_17_10_V1" | "TASK12_OFFICIAL_TEMURIN17_0_17_10_CODEX26_1112_V2" | "TASK12_OFFICIAL_TEMURIN17_0_17_10_MECHANICAL_V1" }): {
  api: {
    inspectOfficialDocumentQualification(path: string, sha256: string): object;
    withOfficialDocumentQualification<T>(proof: object, use: () => Promise<T>): Promise<T>;
  };
  packet(): { name: string; sha256: string };
};
