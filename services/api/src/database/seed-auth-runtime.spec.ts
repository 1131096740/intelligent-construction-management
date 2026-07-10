import {
  resolveSeedAuthRuntime,
  seedAuthLogLines
} from "./seed-auth-runtime";

describe("seed auth runtime", () => {
  it("uses configured SEED_PASSWORD without printing configured or default passwords", () => {
    const configuredPassword = "Local@1-random-seed-password-for-test";
    const developmentDefaultPassword = "development-default-for-test";
    const runtime = resolveSeedAuthRuntime(
      { SEED_PASSWORD: configuredPassword },
      developmentDefaultPassword
    );

    expect(runtime.password).toBe(configuredPassword);
    expect(runtime.shouldLogPassword).toBe(false);
    const output = seedAuthLogLines(runtime, "employee:13800001014").join("\n");
    expect(output).not.toContain(configuredPassword);
    expect(output).not.toContain(developmentDefaultPassword);
    expect(output).not.toContain("Auth seed accounts password:");
    expect(output).toContain("Auth seed accounts: employee:13800001014");
  });

  it("preserves the existing development seed password behavior when env is absent", () => {
    const developmentDefaultPassword = "development-default-for-test";
    const runtime = resolveSeedAuthRuntime({}, developmentDefaultPassword);

    expect(runtime.password).toBe(developmentDefaultPassword);
    expect(runtime.shouldLogPassword).toBe(true);
    expect(seedAuthLogLines(runtime, "employee:13800001014")).toContain(
      `Auth seed accounts password: ${developmentDefaultPassword}`
    );
  });
});
