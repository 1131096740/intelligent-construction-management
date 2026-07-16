import { ForbiddenException } from "@nestjs/common";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

describe("SpotProcurementPilotService", () => {
  const envKey = "SPOT_PROCUREMENT_PILOT_PROJECT_IDS";
  const originalValue = process.env[envKey];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[envKey];
      return;
    }
    process.env[envKey] = originalValue;
  });

  function createService(configuredProjectIds?: string): SpotProcurementPilotService {
    if (configuredProjectIds === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = configuredProjectIds;
    }
    return new SpotProcurementPilotService();
  }

  it("keeps every project disabled when the configuration is empty", () => {
    expect(createService().isEnabled("project-1")).toBe(false);
    expect(createService("").isEnabled("project-1")).toBe(false);
    expect(createService("   ").isEnabled("project-1")).toBe(false);
  });

  it("trims spaces and filters empty entries", () => {
    const service = createService(" project-1, ,project-2,, ");

    expect(service.isEnabled("project-1")).toBe(true);
    expect(service.isEnabled("project-2")).toBe(true);
    expect(service.isEnabled(" project-1 ")).toBe(false);
  });

  it("deduplicates configured IDs and only performs exact matching", () => {
    const service = createService("project-1,project-1,project-10");

    expect(service.isEnabled("project-1")).toBe(true);
    expect(service.isEnabled("project-10")).toBe(true);
    expect(service.isEnabled("project")).toBe(false);
  });

  it("does not perform case-insensitive matching", () => {
    const service = createService("Project-Alpha");

    expect(service.isEnabled("Project-Alpha")).toBe(true);
    expect(service.isEnabled("project-alpha")).toBe(false);
  });

  it("always rejects wildcard configuration", () => {
    const service = createService("*");

    expect(service.isEnabled("*")).toBe(false);
    expect(service.isEnabled("project-1")).toBe(false);
  });

  it.each(["*,project-1", "project-1,*", " *, project-1 "])(
    "disables the entire whitelist when wildcard is mixed into %s",
    (configuredProjectIds) => {
      const service = createService(configuredProjectIds);

      expect(service.isEnabled("project-1")).toBe(false);
      expect(service.isEnabled("project-2")).toBe(false);
      expect(service.isEnabled("*")).toBe(false);
      expect(() => service.assertEnabled("project-1")).toThrow(
        ForbiddenException
      );
      expect(() => service.assertEnabled("project-1")).toThrow(
        "零星采购未对当前项目开放"
      );
    }
  );

  it("rejects an empty project ID with a fixed forbidden error", () => {
    const service = createService("project-1");

    expect(service.isEnabled("")).toBe(false);
    expect(service.isEnabled("   ")).toBe(false);
    expect(() => service.assertEnabled("")).toThrow(ForbiddenException);
    expect(() => service.assertEnabled("   ")).toThrow(
      "零星采购未对当前项目开放"
    );
  });

  it("rejects a project outside the whitelist without leaking configuration", () => {
    const service = createService("confirmed-project,secret-project");

    expect(() => service.assertEnabled("other-project")).toThrow(
      ForbiddenException
    );

    try {
      service.assertEnabled("other-project");
      throw new Error("expected assertEnabled to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const message = (error as ForbiddenException).message;
      expect(message).toBe("零星采购未对当前项目开放");
      expect(message).not.toContain("confirmed-project");
      expect(message).not.toContain("secret-project");
      expect(message).not.toContain("other-project");
    }
  });

  it("captures the environment configuration when each service instance is created", () => {
    const firstService = createService("project-1");
    const secondService = createService("project-2");

    expect(firstService.isEnabled("project-1")).toBe(true);
    expect(firstService.isEnabled("project-2")).toBe(false);
    expect(secondService.isEnabled("project-1")).toBe(false);
    expect(secondService.isEnabled("project-2")).toBe(true);
  });
});
