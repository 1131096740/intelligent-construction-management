import { describe, expect, it } from "vitest";
import { applyJgBusinessGridEdit } from "./jg-business-grid.config";

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
});
