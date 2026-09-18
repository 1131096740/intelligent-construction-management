import { describe, expect, it, vi } from "vitest";

import { gotoWithSingleWebKitInternalErrorRetry } from "../../e2e/support/playwright-navigation";

describe("gotoWithSingleWebKitInternalErrorRetry", () => {
  it("retries exactly once when WebKit reports its internal navigation error", async () => {
    const response = { ok: true };
    const page = {
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error("page.goto: WebKit encountered an internal error"))
        .mockResolvedValueOnce(response)
    };

    await expect(gotoWithSingleWebKitInternalErrorRetry(page, "/付款详情")).resolves.toBe(response);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.goto).toHaveBeenNthCalledWith(1, "/付款详情");
    expect(page.goto).toHaveBeenNthCalledWith(2, "/付款详情");
  });

  it("does not retry other navigation failures", async () => {
    const failure = new Error("page.goto: net::ERR_CONNECTION_REFUSED");
    const page = { goto: vi.fn().mockRejectedValue(failure) };

    await expect(gotoWithSingleWebKitInternalErrorRetry(page, "/付款详情")).rejects.toBe(failure);
    expect(page.goto).toHaveBeenCalledTimes(1);
  });

  it("propagates a repeated WebKit internal error after the single retry", async () => {
    const firstFailure = new Error("page.goto: WebKit encountered an internal error");
    const secondFailure = new Error("page.goto: WebKit encountered an internal error");
    const page = {
      goto: vi.fn().mockRejectedValueOnce(firstFailure).mockRejectedValueOnce(secondFailure)
    };

    await expect(gotoWithSingleWebKitInternalErrorRetry(page, "/付款详情")).rejects.toBe(secondFailure);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
});
