import {
  hasLedgerExportFilters,
  matchesLedgerExportQuery,
  normalizeLedgerExportQuery,
  resolveLedgerExportColumns,
  shanghaiDateKey,
  sortLedgerRows
} from "./ledger-export-query";

describe("ledger-export-query", () => {
  const row = {
    projectId: "project-a",
    occurredAt: "2026-11-20T16:30:00.000Z",
    status: "已确认",
    keywordParts: ["JS-001", "总部综合楼", "甲方公司", "乙方公司"]
  };

  it("normalizes empty and invalid filters", () => {
    expect(normalizeLedgerExportQuery({})).toEqual({ sortDirection: "desc" });
    expect(
      normalizeLedgerExportQuery({
        projectId: " project-a ",
        dateFrom: "2026-11-01",
        dateTo: "2026-11-30",
        status: "已确认",
        keyword: "总部",
        columns: "contractNo, amount ,contractNo",
        sort: "confirmedAt:asc"
      })
    ).toEqual({
      projectId: "project-a",
      dateFrom: "2026-11-01",
      dateTo: "2026-11-30",
      status: "已确认",
      keyword: "总部",
      columnKeys: ["contractNo", "amount"],
      sortField: "confirmedAt",
      sortDirection: "asc"
    });
  });

  it("rejects malformed or reversed dates", () => {
    expect(() => normalizeLedgerExportQuery({ dateFrom: "2026-13-01" })).toThrow(
      "开始日期须为 YYYY-MM-DD 日期"
    );
    expect(() =>
      normalizeLedgerExportQuery({ dateFrom: "2026-11-30", dateTo: "2026-11-01" })
    ).toThrow("开始日期不能晚于结束日期");
  });

  it("compares business dates in Asia/Shanghai", () => {
    expect(shanghaiDateKey("2026-11-20T16:30:00.000Z")).toBe("2026-11-21");
    const query = normalizeLedgerExportQuery({ dateFrom: "2026-11-21", dateTo: "2026-11-21" });
    const filterable = {
      projectId: "project-a",
      occurredAt: "2026-11-20T16:30:00.000Z",
      status: "已确认",
      keywordParts: ["JS-001"]
    };
    expect(matchesLedgerExportQuery(filterable, query)).toBe(true);
    expect(
      matchesLedgerExportQuery(filterable, normalizeLedgerExportQuery({ dateFrom: "2026-11-22" }))
    ).toBe(false);
  });

  it("matches project, status and keyword filters on all visible rows", () => {
    expect(
      matchesLedgerExportQuery(row, normalizeLedgerExportQuery({ projectId: "project-b" }))
    ).toBe(false);
    expect(
      matchesLedgerExportQuery(row, normalizeLedgerExportQuery({ status: "已确认" }))
    ).toBe(true);
    expect(
      matchesLedgerExportQuery(row, normalizeLedgerExportQuery({ status: "待复核" }))
    ).toBe(false);
    expect(
      matchesLedgerExportQuery(row, normalizeLedgerExportQuery({ keyword: "乙方" }))
    ).toBe(true);
    expect(hasLedgerExportFilters(normalizeLedgerExportQuery({ keyword: "乙方" }))).toBe(true);
    expect(hasLedgerExportFilters(normalizeLedgerExportQuery({}))).toBe(false);
  });

  it("keeps required columns even when the user hid them and preserves requested order", () => {
    const columns = [
      { header: "合同编号", key: "contractNo" },
      { header: "项目", key: "project", required: true },
      { header: "合同名称", key: "name" },
      { header: "相对方", key: "counterparty", required: true },
      { header: "金额", key: "amount", required: true },
      { header: "操作", key: "operation" }
    ] as const;
    expect(
      resolveLedgerExportColumns(columns, ["name", "operation", "unknown"]).map((column) => column.key)
    ).toEqual(["project", "name", "counterparty", "amount", "operation"]);
    expect(resolveLedgerExportColumns(columns, undefined).map((column) => column.key)).toEqual([
      "contractNo",
      "project",
      "name",
      "counterparty",
      "amount",
      "operation"
    ]);
  });

  it("sorts only whitelisted fields and keeps unknown values last", () => {
    const rows = [
      { id: "a", amount: 10 },
      { id: "b", amount: null },
      { id: "c", amount: 30 }
    ];
    expect(
      sortLedgerRows(rows, "amount", "desc", { amount: (row) => row.amount }).map((row) => row.id)
    ).toEqual(["c", "a", "b"]);
    expect(
      sortLedgerRows(rows, "unknown", "asc", {}).map((row) => row.id)
    ).toEqual(["a", "b", "c"]);
  });
});
