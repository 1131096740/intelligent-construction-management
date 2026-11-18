"use strict";

const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { createServer } = require("node:net");
const path = require("node:path");

async function withTransferPage(origin, session, viewport, operate) {
  const web = path.resolve(__dirname, "../../../../apps/web-admin");
  const { chromium, expect } = require(require.resolve("@playwright/test", { paths: [web] }));
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  socket.close();
  await once(socket, "close");

  const url = `http://127.0.0.1:${port}`;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
  const vite = spawn(process.execPath, [path.join(web, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: web, env: { ...env, VITE_API_PROXY_TARGET: origin }, stdio: "ignore"
  });
  let browser;
  try {
    await expect.poll(async () => {
      try { return (await fetch(url)).ok; }
      catch { return false; }
    }, { timeout: 30000 }).toBe(true);
    browser = await chromium.launch({ headless: true, env });
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(10000);
    await page.addInitScript(value => {
      localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value));
    }, session);

    const accountsResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/fund-accounts");
    await page.goto(url + "/" + encodeURIComponent("资金账户"));
    const accounts = await accountsResponse;
    expect(accounts.status()).toBe(200);
    const accountData = await accounts.json();
    await page.getByText("资金转款", { exact: true }).click();
    return await operate(page, expect, accountData);
  } finally {
    try { await browser?.close(); }
    finally {
      if (vite.exitCode === null && vite.signalCode === null) {
        const exited = once(vite, "exit");
        vite.kill("SIGTERM");
        await exited;
      }
    }
  }
}

function registerCashTransferInBrowser(origin, session, destinationScope) {
  return withTransferPage(origin, session, { width: 390, height: 844 }, async (page, expect, accountData) => {
    const { accounts: rows } = accountData;
    const company = rows.find(row => row.scopeKey === destinationScope);
    expect(company?.name).toBeTruthy();
    await page.getByRole("button", { name: "现金转公司", exact: true }).click();
    const dialog = page.locator(".t-dialog:visible");
    await dialog.getByRole("textbox", { name: "选择公司" }).click();
    await page.getByRole("listitem", { name: company.name, exact: true }).click();
    await dialog.getByRole("textbox", { name: /转出金额/ }).fill("30.0001");
    await dialog.getByRole("textbox", { name: "转出依据" }).fill("虚构线下交款凭据");
    const registration = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/fund-account-transfers" && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "登记转出" }).click();
    const response = await registration;
    expect(response.status()).toBe(201);
    await expect(page.getByText("转出资金已占用，收款账户尚未增加可用余额。", { exact: true })).toBeVisible();
    console.info("TASK406_BROWSER_REGISTRATION_WITNESS", JSON.stringify({ http: response.status(), viewport: "390x844" }));
    return { status: response.status(), body: await response.json(), command: response.request().postDataJSON() };
  });
}

function confirmCashTransferInBrowser(origin, session, transferId) {
  return withTransferPage(origin, session, { width: 1366, height: 768 }, async (page, expect) => {
    await page.getByRole("button", { name: "确认实收", exact: true }).click();
    const dialog = page.locator(".t-dialog:visible");
    await dialog.getByRole("textbox", { name: "办理依据" }).fill("虚构实收或退回核对");
    const confirmation = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/fund-account-transfers/${transferId}/actions` &&
      response.request().method() === "POST");
    await dialog.getByRole("button", { name: "确认实际收到" }).click();
    const response = await confirmation;
    expect(response.status()).toBe(201);
    await expect(page.getByText("已确认实收", { exact: true })).toBeVisible();
    console.info("TASK406_BROWSER_CONFIRMATION_WITNESS", JSON.stringify({ http: response.status(), viewport: "1366x768" }));
    return { status: response.status(), body: await response.json(), command: response.request().postDataJSON() };
  });
}

module.exports = { registerCashTransferInBrowser, confirmCashTransferInBrowser };
