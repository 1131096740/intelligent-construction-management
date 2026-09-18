import { describe, expect, it } from "vitest";
import {
  applyJgBusinessGridEdit,
  expandJgBusinessGridPaste,
  parseJgBusinessGridClipboardText,
  resolveJgBusinessGridPasteFocus
} from "./jg-business-grid.config";

describe("JgBusinessGrid edit adapter", () => {
  const rows = [
    { materialName: "免烧砖", quantity: "12" },
    { materialName: "砂浆", quantity: "8" }
  ];

  it("updates only the edited cell and keeps the source immutable", () => {
    expect(applyJgBusinessGridEdit(rows, {
      rowIndex: 1,
      prop: "quantity",
      val: 8.5
    })).toEqual([
      { materialName: "免烧砖", quantity: "12" },
      { materialName: "砂浆", quantity: "8.5" }
    ]);
    expect(rows[1]?.quantity).toBe("8");
  });

  it("applies a pasted range by row without touching unrelated rows", () => {
    expect(applyJgBusinessGridEdit(rows, {
      data: {
        0: { materialName: "蒸压砖", quantity: "20" }
      }
    })).toEqual([
      { materialName: "蒸压砖", quantity: "20" },
      { materialName: "砂浆", quantity: "8" }
    ]);
  });

  it("expands a one-row procurement source when the focused grid selection pastes two TSV rows", () => {
    const blankProcurementRow = [{
      materialName: "",
      specification: "",
      unit: "",
      quantity: "",
      note: ""
    }];

    expect(applyJgBusinessGridEdit(blankProcurementRow, {
      data: {
        0: {
          materialName: "砂子",
          specification: "中砂",
          unit: "吨",
          quantity: "2.50",
          note: "现场使用"
        },
        1: {
          materialName: "水泥",
          specification: "P.O 42.5",
          unit: "袋",
          quantity: "0.01",
          note: "补充用料"
        }
      }
    })).toEqual([
      {
        materialName: "砂子",
        specification: "中砂",
        unit: "吨",
        quantity: "2.50",
        note: "现场使用"
      },
      {
        materialName: "水泥",
        specification: "P.O 42.5",
        unit: "袋",
        quantity: "0.01",
        note: "补充用料"
      }
    ]);
  });

  it("ignores pasted rows beyond the real range capacity without mutating old rows", () => {
    const source = [{ materialName: "原材料", quantity: "1", note: "保留" }];

    expect(applyJgBusinessGridEdit(source, {
      data: {
        2: { materialName: "第三行", quantity: "3", note: undefined }
      }
    })).toEqual([{ materialName: "原材料", quantity: "1", note: "保留" }]);
    expect(source).toEqual([{ materialName: "原材料", quantity: "1", note: "保留" }]);
  });

  it("ignores negative, fractional, and unsafe pasted row indexes", () => {
    const source = [{ materialName: "原材料", quantity: "1" }];

    expect(applyJgBusinessGridEdit(source, {
      data: {
        "-1": { materialName: "负数" },
        "1.5": { materialName: "小数" },
        "9007199254740992": { materialName: "不安全整数" }
      }
    })).toEqual([{ materialName: "原材料", quantity: "1" }]);
  });

  it("does not allocate rows for a maximum safe integer paste index", () => {
    const source = [{ materialName: "原材料", quantity: "1" }];

    expect(applyJgBusinessGridEdit(source, {
      data: {
        [Number.MAX_SAFE_INTEGER]: { materialName: "异常远程行" }
      }
    })).toEqual([{ materialName: "原材料", quantity: "1" }]);
  });
});

describe("JgBusinessGrid expanding paste adapter", () => {
  const columns = [
    { prop: "materialName", name: "材料名称" },
    { prop: "specification", name: "规格型号" },
    { prop: "unit", name: "单位" },
    { prop: "quantity", name: "数量" },
    { prop: "note", name: "备注" }
  ];
  const blank = [{
    materialName: "",
    specification: "",
    unit: "",
    quantity: "",
    note: ""
  }];

  it("maps a complete two-row matrix from the focused cell and extends the row shape", () => {
    expect(expandJgBusinessGridPaste(blank, columns, { rowIndex: 0, colIndex: 0 }, [
      ["砂子", "中砂", "吨", "2.50", "现场使用"],
      ["水泥", "P.O 42.5", "袋", "0.01", "补充用料"]
    ])).toEqual([
      { materialName: "砂子", specification: "中砂", unit: "吨", quantity: "2.50", note: "现场使用" },
      { materialName: "水泥", specification: "P.O 42.5", unit: "袋", quantity: "0.01", note: "补充用料" }
    ]);
    expect(blank[0]?.materialName).toBe("");
  });

  it("honors the focused column offset and clips cells beyond the last column", () => {
    expect(expandJgBusinessGridPaste(blank, columns, { rowIndex: 0, colIndex: 3 }, [
      ["3.25", "加急", "裁剪值"],
      ["1", "备用", "裁剪值"]
    ])).toEqual([
      { ...blank[0], quantity: "3.25", note: "加急" },
      { ...blank[0], quantity: "1", note: "备用" }
    ]);
  });

  it("does not cross a boolean readonly column", () => {
    expect(expandJgBusinessGridPaste(blank, [
      columns[0]!,
      { ...columns[1]!, readonly: true },
      columns[2]!
    ], { rowIndex: 0, colIndex: 0 }, [
      ["砂子", "不可写", "吨"],
      ["水泥", "不可写", "袋"]
    ])).toEqual([
      { ...blank[0], materialName: "砂子" },
      { ...blank[0], materialName: "水泥" }
    ]);
  });

  it("fails closed for invalid focus, empty matrices, and functional readonly rules", () => {
    expect(expandJgBusinessGridPaste(blank, columns, { rowIndex: -1, colIndex: 0 }, [["x"], ["y"]])).toBeNull();
    expect(expandJgBusinessGridPaste(blank, columns, { rowIndex: 1, colIndex: 0 }, [["x"], ["y"]])).toBeNull();
    expect(expandJgBusinessGridPaste(blank, columns, { rowIndex: Number.MAX_SAFE_INTEGER, colIndex: 0 }, [["x"], ["y"]])).toBeNull();
    expect(expandJgBusinessGridPaste(blank, columns, { rowIndex: 0, colIndex: 0 }, [])).toBeNull();
    expect(expandJgBusinessGridPaste(blank, [
      { ...columns[0]!, readonly: () => false }
    ], { rowIndex: 0, colIndex: 0 }, [["x"], ["y"]])).toBeNull();
  });

  it("leaves an in-bounds paste to RevoGrid native handling", () => {
    expect(expandJgBusinessGridPaste([
      blank[0]!,
      { ...blank[0]! }
    ], columns, { rowIndex: 0, colIndex: 0 }, [["砂子"], ["水泥"]])).toBeNull();
  });
});

describe("JgBusinessGrid clipboard parser", () => {
  it("parses complete TSV rows without converting decimal text", () => {
    expect(parseJgBusinessGridClipboardText("砂子\t中砂\t吨\t2.50\t现场使用\r\n水泥\tP.O 42.5\t袋\t0.01\t补充用料")).toEqual([
      ["砂子", "中砂", "吨", "2.50", "现场使用"],
      ["水泥", "P.O 42.5", "袋", "0.01", "补充用料"]
    ]);
  });

  it("drops only the terminal clipboard newline and rejects empty text", () => {
    expect(parseJgBusinessGridClipboardText("a\tb\n")).toEqual([["a", "b"]]);
    expect(parseJgBusinessGridClipboardText("")).toBeNull();
  });
});

describe("JgBusinessGrid paste focus resolver", () => {
  const target = (row: string | null, column: string | null) => ({
    getAttribute: (name: string) => name === "data-rgrow" ? row : name === "data-rgcol" ? column : null
  }) as unknown as EventTarget;

  it("uses the nearest real cell coordinates from the composed path", () => {
    expect(resolveJgBusinessGridPasteFocus([
      {} as EventTarget,
      target("1", "3"),
      target("0", "0")
    ], { rowIndex: 9, colIndex: 9 })).toEqual({ rowIndex: 1, colIndex: 3 });
  });

  it("fails an invalid cell coordinate closed and falls back to a valid cache", () => {
    expect(resolveJgBusinessGridPasteFocus([
      target("-1", "2"),
      target("0", "0")
    ], { rowIndex: 0, colIndex: 1 })).toEqual({ rowIndex: 0, colIndex: 1 });
  });

  it("returns null when neither path nor cache has safe nonnegative indexes", () => {
    expect(resolveJgBusinessGridPasteFocus([], { rowIndex: Number.MAX_SAFE_INTEGER + 1, colIndex: 0 })).toBeNull();
    expect(resolveJgBusinessGridPasteFocus([target("x", "0")], null)).toBeNull();
  });
});
