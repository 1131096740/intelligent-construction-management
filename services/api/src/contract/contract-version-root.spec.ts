import { resolveContractVersionRoot } from "./contract-version-root";

const validRoot = {
  id: "root",
  baseVersionId: null,
  changeType: "original",
  status: "effective",
  effectiveAt: new Date("2026-01-01T00:00:00.000Z")
};

type Candidate = {
  id: string;
  baseVersionId: string | null;
  changeType: string;
  status: string;
  effectiveAt: Date | null;
};

describe("resolveContractVersionRoot", () => {
  it.each(["effective", "superseded"])("accepts a single once-effective %s root", (status) => {
    expect(resolveContractVersionRoot([{ ...validRoot, status }])).toEqual({
      ok: true,
      root: { ...validRoot, status }
    });
  });

  const invalidCases: Array<[string, Candidate[]]> = [
    ["no root", [{ ...validRoot, baseVersionId: "other" }]],
    ["multiple roots", [validRoot, { ...validRoot, id: "root-2" }]],
    ["wrong root type", [{ ...validRoot, changeType: "change" }]],
    ["never-effective status", [{ ...validRoot, status: "draft" }]],
    ["missing effective timestamp", [{ ...validRoot, effectiveAt: null }]]
  ];

  it.each(invalidCases)("fails closed for %s", (_label, lineage) => {
    expect(resolveContractVersionRoot(lineage)).toMatchObject({ ok: false });
  });
});
