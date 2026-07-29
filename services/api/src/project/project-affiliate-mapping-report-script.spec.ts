import { createRequire } from "node:module";

const requireFromHere = createRequire(__filename);
const { buildMappingReport } = requireFromHere(
  "../../scripts/inspect-project-affiliate-mapping.cjs"
) as {
  buildMappingReport: (
    projects: Array<{ id: string; code: string; name: string }>,
    assignments: Array<Record<string, unknown>>,
    generatedAt: Date
  ) => {
    mode: string;
    notice: string;
    summary: { ready: number; missing: number; conflict: number };
    rows: Array<{ projectId: string; status: string; affiliateName: string | null }>;
  };
};

describe("read-only project affiliate mapping report", () => {
  it("does not infer an affiliate from a matching project name", () => {
    const report = buildMappingReport(
      [
        { id: "project-1", code: "P-001", name: "某挂靠建设集团项目" },
        { id: "project-2", code: "P-002", name: "已配置项目" }
      ],
      [{
        id: "assignment-2",
        projectId: "project-2",
        businessPartyVersionId: "party-version-2",
        affiliateNameSnapshot: "明确挂靠企业",
        affiliateCreditCodeSnapshot: null,
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z")
      }],
      new Date("2026-07-28T00:00:00.000Z")
    );

    expect(report.mode).toBe("read_only_explicit_mapping");
    expect(report.notice).toContain("未按项目名");
    expect(report.summary).toEqual({ ready: 1, missing: 1, conflict: 0 });
    expect(report.rows[0]).toMatchObject({
      projectId: "project-1",
      status: "missing",
      affiliateName: null
    });
  });
});
