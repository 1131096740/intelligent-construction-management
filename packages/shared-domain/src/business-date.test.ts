import { describe, expect, it } from "vitest";
import { chinaDateOnly, chinaDateTimeInput, requiredPastChinaDate, assertRefundNotBeforePaymentChinaDate } from "./index";

describe("北京时间现金日期协议", () => {
  it("北京00:30可以补录今天和过去，不把今天误判成未来UTC零点", () => {
    const now = new Date("2026-11-04T16:30:00.000Z");
    expect(chinaDateOnly(now)).toBe("2026-11-05");
    expect(chinaDateTimeInput(now)).toBe("2026-11-05 00:30:00");
    expect(requiredPastChinaDate("2026-11-05", "到账日期", now).toISOString()).toBe("2026-11-04T16:00:00.000Z");
    expect(requiredPastChinaDate("2024-02-29", "到账日期", now).toISOString()).toBe("2024-02-28T16:00:00.000Z");
    expect(() => requiredPastChinaDate("2026-11-06", "到账日期", now)).toThrow("不能晚于");
  });
  it("无offset日期时间按北京解释，显式offset保留瞬时，真实未来时刻不放宽", () => {
    const now = new Date("2026-11-05T15:30:00.000Z");
    expect(requiredPastChinaDate("2026-11-05 23:00:00", "付款日期", now).toISOString()).toBe("2026-11-05T15:00:00.000Z");
    expect(requiredPastChinaDate("2026-11-05T10:00:00-05:00", "付款日期", now).toISOString()).toBe("2026-11-05T15:00:00.000Z");
    expect(() => requiredPastChinaDate("2026-11-05T23:31:00", "付款日期", now)).toThrow("不能晚于");
    expect(() => requiredPastChinaDate("2026-11-05T15:31:00Z", "付款日期", now)).toThrow("不能晚于");
    for (const invalid of ["2026-02-30", "2025-02-29", "2026-11-05T25:00:00", "2026-11-05T00:61:00", "2026-1-5", "0000-01-01", "不是日期"]) {
      expect(() => requiredPastChinaDate(invalid, "付款日期", now)).toThrow("格式");
    }
  });
  it("退款只比较北京业务日，同日先后时刻不误拒，前一业务日拒绝", () => {
    const paidAt = new Date("2026-11-04T23:00:00.000Z");
    expect(() => assertRefundNotBeforePaymentChinaDate("2026-11-05", paidAt)).not.toThrow();
    expect(() => assertRefundNotBeforePaymentChinaDate("2026-11-04", paidAt)).toThrow("不能早于付款日期");
    expect(chinaDateOnly("2026-11-04T20:00:00Z")).toBe("2026-11-05");
  });
});
