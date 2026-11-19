import { test as base, expect, type BrowserContext } from "@playwright/test";
export { expect } from "@playwright/test";
interface HttpFailure { url: string; status: number }
const expectedFailures = new WeakMap<BrowserContext, HttpFailure[]>();
export function expectMockHttpFailure(context: BrowserContext, url: string, status: number) {
  const expected = expectedFailures.get(context);
  if (!expected) throw new Error("Browser diagnostics must precede mock responses");
  expected.push({ url, status });
}
export const test = base.extend<{ transportGuard: string[] }>({
  transportGuard: [async ({ context, baseURL }, use, testInfo) => {
    const unexpected: string[] = [], pageErrors: string[] = [], consoleErrors: Array<{ text: string; url: string }> = [];
    const expected: HttpFailure[] = [];
    expectedFailures.set(context, expected);
    context.on("page", page => {
      page.on("pageerror", error => pageErrors.push(error.message));
      page.on("console", event => {
        if (event.type() === "error") consoleErrors.push({ text: event.text(), url: event.location().url });
      });
    });
    const origin = new URL(baseURL!).origin;
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (!/^https?:$/u.test(url.protocol)) return route.continue();
      if (url.origin !== origin) {
        unexpected.push(`${request.method()} external ${url.origin}${url.pathname}`);
        return route.abort("blockedbyclient");
      }
      if (/^\/api(?:\/|$)/u.test(url.pathname)) {
        unexpected.push(`${request.method()} unmocked ${url.pathname}`);
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "测试接口未声明" }) });
      }
      return route.continue();
    });
    await use(unexpected);
    const remaining = [...expected];
    const unexpectedConsole = consoleErrors.filter(event => {
      const status = /^Failed to load resource: the server responded with a status of (\d+)\b/u.exec(event.text);
      const index = status ? remaining.findIndex(item => item.url === event.url && item.status === Number(status[1])) : -1;
      if (index < 0) return true;
      remaining.splice(index, 1); return false;
    });
    await testInfo.attach("transport-and-page-diagnostics", { body: JSON.stringify({ origin, unexpected, pageErrors, consoleErrors, expectedHttpFailures: expected, unexpectedConsole }), contentType: "application/json" });
    expectedFailures.delete(context);
    expect(unexpected, "unexpected network requests").toEqual([]);
    expect(pageErrors, "uncaught page errors").toEqual([]);
    expect(unexpectedConsole, "unexpected console.error").toEqual([]);
  }, { auto: true }],
  page: async ({ context, transportGuard }, use) => {
    void transportGuard;
    const page = await context.newPage(); await use(page); await page.close();
  }
});
