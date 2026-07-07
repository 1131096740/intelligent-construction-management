import { describe, expect, it, vi } from "vitest";
import { confirmSensitiveAction } from "./confirm-sensitive-action";

describe("confirmSensitiveAction", () => {
  it("passes the business consequence message to the confirmation UI", () => {
    const confirm = vi.fn(() => true);

    expect(confirmSensitiveAction("确认后合同版本生效", confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledWith("确认后合同版本生效");
  });

  it("cancels the sensitive action when the user rejects the confirmation", () => {
    expect(confirmSensitiveAction("确认登记实付", () => false)).toBe(false);
  });
});
