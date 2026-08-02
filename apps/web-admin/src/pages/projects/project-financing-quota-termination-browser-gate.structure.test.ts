import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import browserConfig from "../../../playwright.project-financing-quota-termination.config";

const e2eSource = readFileSync(
  new URL("../../../e2e/project-financing-quota-termination.e2e.ts", import.meta.url),
  "utf8"
);
const configSource = readFileSync(
  new URL(
    "../../../playwright.project-financing-quota-termination.config.ts",
    import.meta.url
  ),
  "utf8"
);
const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as { scripts?: Record<string, string> };
const e2eTsconfig = JSON.parse(
  readFileSync(new URL("../../../tsconfig.e2e.json", import.meta.url), "utf8")
) as { include?: string[] };

function singleWebServer() {
  const webServer = browserConfig.webServer;
  if (!webServer || Array.isArray(webServer)) {
    throw new Error("F3 browser gate requires exactly one web server");
  }
  return webServer;
}

describe("project financing quota termination browser gate", () => {
  it("registers a dedicated mocked F3 browser command and typechecks its config", () => {
    expect(
      packageJson.scripts?.["test:e2e:project-financing-quota-termination"]
    ).toBe(
      "playwright test --config playwright.project-financing-quota-termination.config.ts"
    );
    expect(
      packageJson.scripts?.["pretest:e2e:project-financing-quota-termination"]
    ).toBeUndefined();
    expect(e2eTsconfig.include).toContain(
      "playwright.project-financing-quota-termination.config.ts"
    );
    expect(browserConfig.testMatch).toBe(
      "project-financing-quota-termination.e2e.ts"
    );
  });

  it("binds only a strict loopback preview and keeps all artifacts outside the repository", () => {
    const webServer = singleWebServer();
    expect(browserConfig.use).toMatchObject({
      baseURL: "http://127.0.0.1:4194",
      screenshot: "only-on-failure",
      trace: "retain-on-failure"
    });
    expect(webServer).toMatchObject({
      command:
        "pnpm build && pnpm preview --host 127.0.0.1 --port 4194 --strictPort",
      reuseExistingServer: false,
      url: "http://127.0.0.1:4194"
    });
    expect(browserConfig.reporter).toBe("line");
    expect(typeof browserConfig.outputDir).toBe("string");
    const outputDir = String(browserConfig.outputDir);
    const relativeOutputDir = relative(tmpdir(), outputDir);
    expect(relativeOutputDir).not.toBe("");
    expect(relativeOutputDir === ".." || relativeOutputDir.startsWith(`..${sep}`))
      .toBe(false);
    expect(isAbsolute(relativeOutputDir)).toBe(false);
    expect(configSource).not.toContain("0.0.0.0");
    expect(configSource).not.toContain("playwright-report");
  });

  it("covers Chromium and WebKit at the approved desktop and mobile viewports", () => {
    expect(browserConfig.projects?.map((project) => ({
      browser: project.use?.defaultBrowserType,
      isMobile: project.use?.isMobile,
      name: project.name,
      viewport: project.use?.viewport
    }))).toEqual([
      {
        browser: "chromium",
        isMobile: false,
        name: "chromium-desktop",
        viewport: { width: 1366, height: 768 }
      },
      {
        browser: "webkit",
        isMobile: false,
        name: "webkit-desktop",
        viewport: { width: 1366, height: 768 }
      },
      {
        browser: "chromium",
        isMobile: true,
        name: "chromium-mobile",
        viewport: { width: 390, height: 844 }
      },
      {
        browser: "webkit",
        isMobile: true,
        name: "webkit-mobile",
        viewport: { width: 390, height: 844 }
      }
    ]);
  });

  it("drives the F3 happy path through one exact frozen POST and authoritative GET", () => {
    expect(e2eSource).toContain('page.goto("/项目经营")');
    expect(e2eSource).toContain("/termination-capability");
    expect(e2eSource).toContain("/termination");
    expect(e2eSource).toContain("terminationPosts");
    expect(e2eSource).toContain("authoritativeWorkbenchGets");
    expect(e2eSource).toContain("双击只发送一次终止 POST");
    expect(e2eSource).toContain("成功后读取权威台账");
    expect(e2eSource).toContain("probe.criticalOrder");
    expect(e2eSource).toContain("`capability:${PROJECT_A.id}`");
    expect(e2eSource).toContain("`termination:${PROJECT_A.id}`");
    expect(e2eSource).toContain("expect(Object.keys(terminationBody).sort()).toEqual(");
    expect(e2eSource).toContain("expect.stringMatching(UUID_V4_PATTERN)");
    expect(e2eSource).toContain("expectedLifecycleToken: TOKEN_A");
    expect(e2eSource).toContain("reason: TERMINATION_REASON");
    expect(e2eSource).toContain(
      "confirmationPassword: TERMINATION_PASSWORD_INPUT"
    );
    expect(e2eSource).toContain("expect(probe.terminationRawBodies[0]).toBe(");
    expect(e2eSource).toContain("await confirm.dblclick()");
    expect(e2eSource).toContain("confirm.click()");
  });

  it("covers unknown-outcome retry, stale capability and cross-project late results", () => {
    expect(e2eSource).toContain("网络结果未知时使用完全相同的 actionId 和 body 重试");
    expect(e2eSource).toContain("能力或生命周期令牌漂移时关闭失败");
    expect(e2eSource).toContain("跨项目迟到结果不会污染当前项目");
    expect(e2eSource).toContain("expect(retryBodies[1]).toEqual(retryBodies[0])");
    expect(e2eSource).toContain("expect(retryBodies[1]?.actionId).toBe(");
    expect(e2eSource).toContain("probe.capabilityGets).toBe(2)");
    expect(e2eSource).toContain(
      "成功回执后权威 workbench GET 失败时重试只能 GET"
    );
    expect(e2eSource).toContain(
      "终止 POST 返回 4xx 后重置尝试并重新执行提交 preflight"
    );
    expect(e2eSource).toContain("lateCapability");
    expect(e2eSource).not.toContain("lateTermination");
  });

  it("asserts success evidence, responsive containment and a clean browser error surface", () => {
    expect(e2eSource).toContain("expectNoDocumentHorizontalOverflow");
    expect(e2eSource).toContain("expectNoNestedHorizontalScrollers");
    expect(e2eSource).toContain('page.on("console"');
    expect(e2eSource).toContain('page.on("pageerror"');
    expect(e2eSource).toContain("expect(runtimeErrors).toEqual([])");
    expect(e2eSource).toContain(
      '"vite-error-overlay, #webpack-dev-server-client-overlay"'
    );
    expect(e2eSource).toContain("getBoundingClientRect()");
    expect(e2eSource).toContain("document.elementFromPoint(centerX, centerY)");
    expect(e2eSource).toContain("await expectViewportControl(dialog)");
    expect(e2eSource).toContain("await expectViewportControl(confirm)");
    expect(e2eSource).toContain("page.screenshot({");
    expect(e2eSource).toContain("testInfo.outputPath(");
  });
});
