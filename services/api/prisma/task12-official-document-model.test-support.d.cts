/** Model-only FS/Git/hash boundaries, not a physical qualification result. */
export function model(options?: { jdkLink?: boolean }): {
  api: {
    inspectOfficialDocumentQualification(path: string, sha256: string): object;
    withOfficialDocumentQualification<T>(proof: object, use: () => Promise<T>): Promise<T>;
  };
  packet(): { name: string; sha256: string };
};
