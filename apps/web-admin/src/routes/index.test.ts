import { describe, expect, it } from "vitest";
import { webAdminRoutes } from "./route-records";

describe("web admin routes", () => {
  it("redirects the root path to the contract ledger", () => {
    const rootRoute = webAdminRoutes.find((route) => route.path === "/");

    expect(rootRoute).toBeDefined();
    expect(rootRoute?.redirect).toBe("/contracts");
  });

  it("renders all primary business modules under the admin layout", () => {
    const shellRoute = webAdminRoutes.find((route) => route.path === "/");
    const childPaths = shellRoute?.children?.map((route) => route.path);

    expect(shellRoute?.component).toBeDefined();
    expect(childPaths).toEqual([
      "contracts",
      "contracts/:contractId",
      "settlements",
      "settlements/:settlementId",
      "payments",
      "payments/:paymentId",
      "archives",
      "audit"
    ]);
  });
});
