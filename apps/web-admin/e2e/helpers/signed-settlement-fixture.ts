import { expect, type Page } from "@playwright/test";
import type { SignedSettlementDraft, SignedSettlementFile, SignedSettlementRow } from "../../src/api/signed-contract-settlement.api";

export const signedSettlementUrl = "/结算工作台/已签登记?projectId=project-1";
const path = "/api/projects/project-1/signed-contract-settlements";
const contract = { kind: "downstream", id: "contract-1", label: "钢材采购合同", relationship: "inside" };
const existingFile = { fileId: "original-1", originalName: "已签原件.pdf", mimeType: "application/pdf" };

export async function signedSettlementFixture(page: Page, state?: SignedSettlementRow["state"]) {
  const calls = { legacy: [] as string[], save: [] as Array<{ method: string; body: SignedSettlementDraft & { revision?: number } }>,
    submissions: [] as number[], reviews: [] as unknown[] };
  const files: SignedSettlementFile[] = [existingFile];
  let row: SignedSettlementRow | undefined = state ? {
    id: "signed-1", contractId: contract.id, contractKind: "downstream",
    number: "JS-01", amountYuan: "40.0000", state, revision: 3,
    reviewReason: state === "returned" ? "请核对已签金额" : null,
    attachments: [existingFile], canUpdate: ["draft", "returned"].includes(state),
    canReview: state === "pending_review", selfReview: false, canReadAttachments: true
  } : undefined;
  await page.route("**/api/auth/login", route => route.fulfill({ json: {
    user: { id: "contract-user", name: "合同经办", phone: "13900000000", mustChangePassword: false,
      roleKeys: ["contract_staff", "contract_director"], globalRoleKeys: ["contract_staff", "contract_director"] },
    tokens: { accessToken: "local-access-token", refreshToken: "local-refresh-token", expiresIn: 900 }
  } }));
  await page.route("**/api/me/work-items", route => route.fulfill({ json: {
    generatedAt: new Date().toISOString(), visibleProjectCount: 1,
    queues: { pending: [], blocked: [], started: [] },
    approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
  } }));
  await page.route("**/api/projects", route => route.fulfill({ json: [{ id: "project-1", code: "GC-01", name: "一号项目" }] }));
  await page.route("**/api/projects/project-1/settlement-drafts**", route => {
    calls.legacy.push(route.request().method());
    return route.fulfill({ status: 410 });
  });
  await page.route(url => url.pathname === path || url.pathname.startsWith(`${path}/`), async route => {
    const request = route.request();
    const suffix = new URL(request.url()).pathname.slice(path.length);
    if (request.method() === "GET") {
      if (suffix === "/contracts") return route.fulfill({ json: [contract] });
      if (suffix === "/contract-overview") return route.fulfill({ json: {
        name: contract.label, party: "建设公司", counterparty: "钢材供应商", confirmedYuan: "100.0000", canRegister: true
      } });
      return route.fulfill({ json: row ? [row] : [] });
    }
    if (suffix === "/files") {
      const originalName = /filename="([^"]+)"/u.exec(request.postData() ?? "")?.[1] ?? "synthetic.pdf";
      const file = { fileId: `uploaded-${files.length}`, originalName, mimeType: "application/pdf" };
      files.push(file);
      return route.fulfill({ status: 201, json: { ...file, id: file.fileId } });
    }
    if (suffix.endsWith("/submission")) {
      calls.submissions.push(request.postDataJSON().revision);
      row = { ...row!, state: "pending_review", revision: row!.revision + 1, canUpdate: false };
      return route.fulfill({ status: 201, json: row });
    }
    if (suffix.endsWith("/review")) {
      const body = request.postDataJSON();
      calls.reviews.push(body);
      row = { ...row!, state: body.decision === "confirm" ? "confirmed" : "returned", canReview: false };
      return route.fulfill({ status: 201, json: row });
    }
    const body = request.postDataJSON() as SignedSettlementDraft & { revision?: number };
    calls.save.push({ method: request.method(), body });
    row = { id: "signed-1", contractId: body.contractId, contractKind: body.contractKind,
      number: body.number, amountYuan: body.amountYuan, state: "draft", revision: (row?.revision ?? 0) + 1,
      reviewReason: null, attachments: files.filter(file => body.fileIds.includes(file.fileId)),
      canUpdate: true, canReview: false, selfReview: false, canReadAttachments: true,
      duplicateNumber: body.number === "JS-DUP" };
    return route.fulfill({ status: request.method() === "PATCH" ? 200 : 201, json: row });
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Local@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/u);
  return calls;
}

export async function selectSignedContract(page: Page) {
  await page.locator(".t-form__item").filter({ hasText: /^合同/u }).locator(".t-select").click();
  await page.getByText("表内 · 钢材采购合同", { exact: true }).click();
  await expect(page.locator(".t-select__dropdown:visible")).toHaveCount(0);
  await expect(page.getByText("签约双方：建设公司、钢材供应商")).toBeVisible();
}

export function settlementNumberField(page: Page) {
  return page.locator(".t-form__item").filter({ hasText: "手填结算编号" }).locator("input");
}

export function syntheticPdf(name: string) {
  return { name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") };
}
