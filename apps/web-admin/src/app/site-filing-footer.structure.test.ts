import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const footer = readFileSync(new URL("../components/SiteFilingFooter.vue", import.meta.url), "utf8");
const adminLayout = readFileSync(new URL("./AdminLayout.vue", import.meta.url), "utf8");
const loginPage = readFileSync(new URL("../pages/login/LoginPage.vue", import.meta.url), "utf8");
const changePasswordPage = readFileSync(new URL("../pages/login/ChangePasswordPage.vue", import.meta.url), "utf8");

describe("site ICP filing footer", () => {
  it("links the approved filing number to the MIIT filing service", () => {
    expect(footer).toContain("滇ICP备2026013686号-1");
    expect(footer).toContain('href="https://beian.miit.gov.cn/"');
    expect(footer).toContain('target="_blank"');
    expect(footer).toContain('rel="noopener noreferrer"');
  });

  it("is visible on login, password change and authenticated layouts", () => {
    for (const shell of [adminLayout, loginPage, changePasswordPage]) {
      expect(shell).toContain("<SiteFilingFooter />");
    }
  });

  it("keeps the authentication forms centered over the shared full-page background", () => {
    for (const shell of [loginPage, changePasswordPage]) {
      expect(shell).toContain(":global(body)");
      expect(shell).toContain('url("/images/auth-background.png") center / cover no-repeat');
      expect(shell).toContain("place-items: center;");
      expect(shell).toContain("position: absolute;");
      expect(shell).toContain(".site-filing-footer");
    }
  });
});
