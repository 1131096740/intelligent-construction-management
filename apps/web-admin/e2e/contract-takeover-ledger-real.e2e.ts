import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Response as BrowserResponse } from "@playwright/test";

type EvidenceFile = {
  recordId: string;
  fileId: string;
  fileName: string;
  purpose: string;
  mimeType: string;
  sizeBytes: number;
};
type Takeover = Record<string, unknown> & {
  id: string;
  takeoverStatus: string;
  updatedAt: string;
  evidenceFiles: EvidenceFile[];
  availableActions: unknown[];
};
type LedgerRow = {
  contractVersionId: string;
  contractNo: string;
  amount: string;
  currentNode: string;
  workbenchEditable: boolean;
  copyAvailable: boolean;
  contractLifecycleCapabilities: Record<string, boolean>;
};
const moneyFields = [
  "amountCents", "historicalSettledCents", "historicalApprovalPendingPaymentCents",
  "historicalApprovedPendingPaymentCents", "historicalPaidCents", "historicalProxyPaidCents",
  "historicalAdvancePaidCents", "historicalAdvanceDeductedCents", "historicalRetentionWithheldCents",
  "historicalRetentionReleasedCents", "otherConfirmedOccupancyCents"
] as const;

function money(detail: Takeover) {
  return Object.fromEntries(moneyFields.map(key => {
    expect(typeof detail[key], `金额字段 ${key} 必须保留整数字符串`).toBe("string");
    expect(detail[key]).toMatch(/^\d+$/u);
    return [key, detail[key]];
  }));
}

function evidence(detail: Takeover) {
  return detail.evidenceFiles.map(file => ({
    recordId: file.recordId, fileId: file.fileId, fileName: file.fileName,
    purpose: file.purpose, mimeType: file.mimeType, sizeBytes: file.sizeBytes
  })).sort((left, right) => left.recordId.localeCompare(right.recordId));
}

test("真实历史接管提交复核、放弃后台账和详情恢复读取，金额和附件保持", async ({ page }, info) => {
  const api = process.env.REAL_API_BASE_URL ?? "";
  const password = process.env.REAL_ROLE_PASSWORD;
  const projectId = process.env.LEDGER_TAKEOVER_PROJECT_ID;
  const candidateSha = process.env.REAL_BROWSER_CANDIDATE_SHA;
  const evidencePath = process.env.REAL_BROWSER_EVIDENCE_PATH;
  const pdf = Buffer.from(process.env.LEDGER_TAKEOVER_PDF_BASE64 ?? "", "base64");
  expect(api, "只允许现有本机隔离UAT API").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(info.project.use.baseURL, "实际浏览器登录及业务请求也必须指向本机").toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  expect(password).toBeTruthy();
  expect(projectId).toBeTruthy();
  expect(candidateSha).toMatch(/^[0-9a-f]{40}$/u);
  expect(evidencePath).toMatch(/^\/.+\.json$/u);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(100);

  const requests: Array<{ method: string; path: string; status: number }> = [];
  const code = `LEDGER-${info.project.name.includes("webkit") ? "M" : "D"}-${randomUUID().slice(0, 8)}`;
  let takeoverId: string | null = null;
  let pageErrors = 0;
  let consoleErrors = 0;
  let failedRequests = 0;
  let complete = false;
  const checks = {
    submittedAndAbandoned: false, formalLedgerReadable: false,
    otherContractPreserved: false, workbenchReadableAndReadonly: false,
    historicalDetailReadonly: false, moneyUnchanged: false,
    evidenceMetadataUnchanged: false, evidenceBytesUnchanged: false,
    abandonedStatusDisplayed: false
  };
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/")) requests.push({ method: response.request().method(), path, status: response.status() });
  });
  page.on("pageerror", () => { pageErrors += 1; });
  page.on("console", message => { if (message.type() === "error") consoleErrors += 1; });
  page.on("requestfailed", request => {
    if (new URL(request.url()).pathname.startsWith("/api/") &&
      !/ERR_ABORTED|cancelled/u.test(request.failure()?.errorText ?? "")) failedRequests += 1;
  });

  try {
    await page.goto("/login");
    await page.getByPlaceholder("请输入手机号").fill("13800000001");
    await page.getByPlaceholder("请输入密码").fill(password!);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect.poll(() => decodeURI(new URL(page.url()).pathname)).toBe("/首页");
    const accessToken = await page.evaluate(() => {
      const raw = window.localStorage.getItem("jiangkong-web-admin-auth");
      return raw ? (JSON.parse(raw) as { accessToken?: string }).accessToken : undefined;
    });
    expect(Boolean(accessToken), "真实登录应取得隔离会话").toBe(true);
    const headers = { authorization: `Bearer ${accessToken}` };
    async function request(method: string, path: string, data?: unknown) {
      const response = await page.request.fetch(`/api${path}`, { method, headers, data });
      requests.push({ method, path: `/api${new URL(path, api).pathname}`, status: response.status() });
      return response;
    }
    async function read<T>(path: string): Promise<T> {
      const response = await request("GET", path);
      expect(response.status(), `读取 ${new URL(path, api).pathname}`).toBe(200);
      return await response.json() as T;
    }
    async function downloadedBytes(fileId: string) {
      const ticket = await request("POST", `/files/${fileId}/download-ticket`, {
        confirmationPassword: password,
        downloadReason: "本机历史接管放弃前后附件守恒验收",
        accessMode: "download"
      });
      expect(ticket.status(), "真实附件下载票据应通过权限及密码校验").toBe(201);
      const body = await ticket.json() as { downloadUrl: string };
      expect(body.downloadUrl).toMatch(/^\/files\/[^/]+\/download\?/u);
      const download = await page.request.get(`/api${body.downloadUrl}`);
      requests.push({ method: "GET", path: `/api/files/${fileId}/download`, status: download.status() });
      expect(download.status(), "附件内容应可实际读取").toBe(200);
      return download.body();
    }
    const normalBefore = await read<{ rows: LedgerRow[] }>("/contracts/lifecycle-ledger?view=formal_ledger&pageSize=20");
    const normal = normalBefore.rows.find(row => row.contractNo && /^¥[\d,.]+$/u.test(row.amount));
    expect(normal, "保留既有正常合同作为对照，不能只验证新增历史条目").toBeTruthy();

    const prefix = `/projects/${projectId}/contract-takeovers`;
    const creation = await request("POST", prefix, {
      code, name: "本机历史接管关闭读取验收", counterparty: "本机合成相对方",
      amountCents: "20001", signedAt: "2026-01-01", takeoverLevel: "A",
      lifecycleStatus: "completed", paymentTermsOriginalText: "仅本机回归，不发起付款",
      historicalSettledCents: "0", historicalPaidCents: "0",
      balanceSourceSummary: "本机合成资料，无真实历史资金事实",
      evidenceSummary: "本轮生成的合成PDF",
      takeoverLevelAdjustmentReason: "仅本机隔离关闭读取验收"
    });
    expect(creation.status()).toBe(201);
    const created = await creation.json() as Takeover;
    takeoverId = created.id;
    const detailPath = `${prefix}/${created.id}`;
    const route = `/历史合同接管?projectId=${encodeURIComponent(projectId!)}&takeoverId=${created.id}`;
    await page.goto(route);
    await expect(page.locator(".detail-title")).toContainText(code);
    const row = page.locator(".ledger-panel tbody tr").filter({ hasText: code });
    await expect(row).toHaveCount(1);
    const uploader = page.locator(".detail-panel .evidence-uploader").first();
    await uploader.locator("select").selectOption("historical_contract_scan");
    const fileName = `${code}-合成历史合同.pdf`;
    await uploader.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
    const isPost = (path: string) => (response: BrowserResponse) =>
      new URL(response.url()).pathname === `/api${path}` && response.request().method() === "POST";
    const [uploaded, bound] = await Promise.all([
      page.waitForResponse(isPost(`${prefix}/files`)),
      page.waitForResponse(isPost(`${detailPath}/evidence-files`)),
      uploader.getByRole("button", { name: "上传接管资料", exact: true }).click()
    ]);
    expect(uploaded.status()).toBe(201);
    expect(bound.status()).toBe(201);
    await expect(page.locator(".detail-panel").getByText(fileName, { exact: true }).first()).toBeVisible();
    const before = await read<Takeover>(detailPath);
    expect(before.evidenceFiles).toHaveLength(1);
    expect(before.amountCents).toBe("20001");
    const fileId = before.evidenceFiles[0]!.fileId;
    expect(await downloadedBytes(fileId)).toEqual(pdf);

    const [submittedResponse] = await Promise.all([
      page.waitForResponse(isPost(`${detailPath}/review-submission`)),
      row.getByText("提交复核", { exact: true }).click()
    ]);
    expect(submittedResponse.status()).toBe(201);
    const submitted = await submittedResponse.json() as Takeover;
    expect(submitted.takeoverStatus).toBe("pending_review");
    expect(money(submitted)).toEqual(money(before));
    expect(evidence(submitted)).toEqual(evidence(before));
    await expect(page.getByText("已提交业务复核", { exact: true })).toBeVisible();
    await page.locator(".business-draft-action").getByRole("button", { name: "放弃历史接管申请", exact: true }).click();
    const dialog = page.locator(".t-dialog:visible");
    const reason = "本机合成验收：提交复核后放弃，验证台账和附件保持";
    await dialog.getByPlaceholder("说明本次操作原因").fill(reason);
    const confirm = dialog.getByRole("button", { name: "确认放弃申请", exact: true });
    await confirm.evaluate(async element => {
      const animations = [];
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        animations.push(...parent.getAnimations());
      }
      await Promise.all(animations.filter(animation =>
        animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    });
    const [abandonedResponse] = await Promise.all([
      page.waitForResponse(isPost(`${detailPath}/abandonment`)),
      confirm.click()
    ]);
    expect(abandonedResponse.status()).toBe(201);
    expect(abandonedResponse.request().postDataJSON()).toEqual({
      expectedUpdatedAt: submitted.updatedAt, action: "abandon_application", reason
    });
    await expect(page.getByText("历史合同接管申请已放弃", { exact: true })).toBeVisible();
    checks.submittedAndAbandoned = true;

    const formalPending = page.waitForResponse(response =>
      new URL(response.url()).pathname === "/api/contracts/lifecycle-ledger" &&
      new URL(response.url()).searchParams.get("view") === "formal_ledger");
    await page.goto("/合同工作台?view=formal_ledger");
    const formalResponse = await formalPending;
    expect(formalResponse.status()).toBe(200);
    const formal = await formalResponse.json() as { rows: LedgerRow[] };
    const normalAfter = formal.rows.find(item => item.contractVersionId === normal!.contractVersionId);
    expect(normalAfter).toMatchObject({ contractNo: normal!.contractNo, amount: normal!.amount });
    expect(formal.rows.some(item => item.contractNo === code)).toBe(false);
    await expect(page.locator("#contract-ledger-title")).toBeVisible();
    await expect(page.getByText("合同记录暂时无法读取", { exact: true })).toHaveCount(0);
    const normalPageRow = page.locator('[aria-labelledby="contract-ledger-title"] tbody tr').filter({ hasText: normal!.contractNo });
    await expect(normalPageRow).toHaveCount(1);
    await expect(normalPageRow).toContainText(normal!.amount);
    checks.formalLedgerReadable = true;
    checks.otherContractPreserved = true;
    await page.screenshot({ path: info.outputPath("放弃后正式台账正常.png"), fullPage: true });

    const workbench = await read<{ rows: LedgerRow[] }>("/contracts/workbench?view=all&pageSize=100");
    expect(workbench.rows.find(item => item.contractVersionId === normal!.contractVersionId)).toMatchObject({ amount: normal!.amount });
    expect(workbench.rows.find(item => item.contractNo === code)).toMatchObject({
      amount: "¥200.01", currentNode: "已放弃", workbenchEditable: false, copyAvailable: false,
      contractLifecycleCapabilities: { canEdit: false, canSubmit: false, canAbandon: false, canPhysicallyDelete: false }
    });
    checks.workbenchReadableAndReadonly = true;

    await page.goto(route);
    await expect(page.locator(".detail-title")).toContainText(code);
    const after = await read<Takeover>(detailPath);
    expect(after).toMatchObject({ takeoverStatus: "abandoned", lifecycleKind: "formal_record", availableActions: [] });
    expect(money(after)).toEqual(money(before));
    expect(evidence(after)).toEqual(evidence(before));
    expect(await downloadedBytes(fileId)).toEqual(pdf);
    checks.moneyUnchanged = true;
    checks.evidenceMetadataUnchanged = true;
    checks.evidenceBytesUnchanged = true;
    for (const name of ["编辑", "提交复核"]) {
      const action = row.getByText(name, { exact: true });
      await expect(action).toHaveCount(1);
      expect(await action.evaluate(element => element.classList.contains("t-is-disabled") ||
        element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled"))).toBe(true);
    }
    await expect(page.locator(".business-draft-action button")).toHaveCount(0);
    await expect(uploader.getByRole("button", { name: "上传接管资料", exact: true })).toBeDisabled();
    checks.historicalDetailReadonly = true;
    // Keep this user-visible status assertion: an unknown label is not a passed abandoned-state check.
    await expect(row).toContainText("已放弃");
    await expect(row).not.toContainText("接管状态未读取");
    checks.abandonedStatusDisplayed = true;
    await page.screenshot({ path: info.outputPath("已放弃历史详情只读且资料保留.png"), fullPage: true });
    expect(pageErrors).toBe(0);
    expect(consoleErrors).toBe(0);
    expect(failedRequests).toBe(0);
    complete = true;
  } finally {
    writeFileSync(evidencePath!.replace(/\.json$/u, `-${info.project.name}.json`), `${JSON.stringify({
      schemaVersion: 1, candidateSha, status: complete ? "passed" : "failed",
      gate: "historical-takeover-abandoned-ledger-real-browser", project: info.project.name,
      productionData: false, syntheticContractNo: code, takeoverId, checks, requests,
      pdfSha256: createHash("sha256").update(pdf).digest("hex"),
      pageErrors, consoleErrors, failedRequests
    }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
});
