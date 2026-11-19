import { Prisma } from "@prisma/client";
import { planRegisteredFundAdvance } from "./registered-fund-advance-plan";

describe("到账垫资本金", () => {
  const current = {
    id: "confirmed-v3",
    balanceYuan: new Prisma.Decimal("90.0001"),
    coveredExecutionIds: ["covered-payment"],
    sources: [{
      id: "original-funds",
      lineNo: 4,
      amountYuan: new Prisma.Decimal("90.0001"),
      sourceStatus: "known",
      sourceName: "既有资金来源",
      projectStatus: "pending",
      projectId: null,
    }],
  };
  const arrival = { amountYuan: "12.0002", contributorNameSnapshot: "实际出资人", projectId: "project-1" };

  it("按四位追加确收本金，保留覆盖实付及旧来源谱系", () => {
    const next = planRegisteredFundAdvance(current, current.id, arrival);
    expect(next.balanceYuan).toBe("102.0003");
    expect(next.coveredExecutionIds).toEqual(["covered-payment"]);
    expect(next.sources).toMatchObject([{
      previousSourceBatchId: "original-funds", sourceName: "既有资金来源", lineNo: 4,
    }]);
    expect(next.originalSource).toMatchObject({
      lineNo: 5, amountYuan: "12.0002", sourceStatus: "known",
      sourceName: "实际出资人", projectStatus: "project", projectId: "project-1",
    });
  });

  it("已核对为零可确收，未知余额不可自动当零", () => {
    expect(planRegisteredFundAdvance({ ...current, balanceYuan: new Prisma.Decimal(0), sources: [] }, current.id, arrival).balanceYuan).toBe("12.0002");
    expect(() => planRegisteredFundAdvance({ ...current, balanceYuan: null, sources: [] }, current.id, arrival)).toThrow("账户余额待核对");
    expect(() => planRegisteredFundAdvance(null, current.id, arrival)).toThrow("账户余额待核对");
  });

  it("旧版本拒绝，已知余额中的来源不明仍保留待核对", () => {
    expect(() => planRegisteredFundAdvance(current, "obsolete", arrival)).toThrow("资金登记版本已变化");
    const next = planRegisteredFundAdvance(current, current.id, { ...arrival, contributorNameSnapshot: null, projectId: null });
    expect(next.originalSource).toMatchObject({ sourceStatus: "pending", sourceName: null, projectStatus: "pending", projectId: null });
  });
});
