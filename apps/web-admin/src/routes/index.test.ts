import { describe, expect, it } from "vitest";
import { webAdminRoutes } from "./route-records";

describe("web admin routes", () => {
  it("routes the root path to the workbench page", () => {
    const rootRoute = webAdminRoutes.find((route) => route.path === "/");

    expect(rootRoute).toBeDefined();
    expect(rootRoute?.component).toBeDefined();
  });
});
