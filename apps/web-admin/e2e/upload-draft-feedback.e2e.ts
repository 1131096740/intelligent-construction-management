import { expect, test, type Page } from "@playwright/test";

async function harness(page: Page, kind: string) {
  await page.route("**/__local-upload-draft-test?*", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/e2e/fixtures/upload-draft-harness.ts"></script></body></html>' }));
  await page.goto(`/__local-upload-draft-test?kind=${kind}`);
}
const file = { name: "历史资料.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 local synthetic fixture") };
for (const width of [1280, 390]) {
  for (const failure of ["upload", "association", "lost-response"] as const) {
    test(`结算附件 ${width} ${failure} 就近提示和保留文件重试`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      let uploads = 0; let attachments = 0; let linked = false;
      const keys: string[] = [];
      await page.route("**/api/**", async route => {
        const url = new URL(route.request().url()); const path = url.pathname;
        if (!path.startsWith("/api/")) return route.continue();
        let body: unknown = {};
        if (path.endsWith("/capability")) body = { projectId: "project-1", availableActions: ["attach_line_file"] };
        else if (path.endsWith("/files")) {
          uploads++; keys.push(route.request().postData() ?? "");
          if (failure === "upload" && uploads === 1) return route.fulfill({ status: 413, json: { message: "文件超过上传大小限制" } });
          body = { id: "file-1" };
        } else if (path.endsWith("/lines/line-1/attachments")) {
          attachments++;
          if (failure === "association" && attachments === 1) return route.fulfill({ status: 409, json: { message: "草稿版本已变化，请刷新后重试" } });
          linked = true;
          if (failure === "lost-response" && attachments === 1) return route.abort("failed");
          body = { revision: 2 };
        } else if (path.endsWith("/line-attachments")) body = linked ? [{ id: "attachment-1", lineKey: "line-1", fileId: "file-1", fileName: file.name, purpose: "现场签证", status: "active" }] : [];
        else if (path.endsWith("/draft-1")) body = { id: "draft-1", revision: 2 };
        return route.fulfill({ json: body });
      });
      await harness(page, "settlement");
      await page.locator(".t-select").click(); await page.getByText("现场施工明细", { exact: true }).last().click();
      await page.getByPlaceholder("如：现场签证单、计量凭证").fill("现场签证");
      await page.locator('input[type="file"]').setInputFiles(file);
      const error = page.locator('[role="alert"]').filter({ hasText: "已保留所选文件" });
      await expect(error).toBeVisible();
      await expect(page.getByText(`已选择：${file.name}`, { exact: false })).toBeVisible();
      expect(await page.locator('input[type="file"]').evaluate(element => (element as HTMLInputElement).files?.[0]?.name)).toBe(file.name);
      const box = await error.boundingBox(); expect(box!.y).toBeLessThan(844);
      await page.getByRole("button", { name: "重试上传", exact: true }).click();
      await expect(page.getByText("附件已关联；请重新生成冻结结算单。", { exact: true })).toBeVisible();
      await expect(page.locator('input[type="file"]')).toHaveValue("");
      expect(uploads).toBe(failure === "upload" ? 2 : 1);
      expect(attachments).toBe(failure === "association" ? 2 : 1);
      if (uploads === 2) expect(keys[0].match(/[a-f0-9]{8}-[a-f0-9-]{27}/)?.[0]).toBe(keys[1].match(/[a-f0-9]{8}-[a-f0-9-]{27}/)?.[0]);
    });
  }
  test(`经营接管 ${width} 多文件部分失败保留并复用已上传文件`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let uploads = 0; let associations = 0;
    const batch = { id: "batch-1", batchNo: "本地合成批次", sourceFileId: null, status: "draft", revision: 1, totalRows: 1, readyRows: 1, blockedRows: 0, warningRows: 0, sceneKeys: [], createdAt: null, rows: [], confirmations: [], activation: null };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path.endsWith("/projects")) return route.fulfill({ json: [{ id: "project-1", code: "TEST", name: "隔离测试项目" }] });
      if (path.endsWith("/capability")) return route.fulfill({ json: { projectId: "project-1", scenes: [], actions: {}, confirmationProfessions: {}, availableActions: ["file_upload"] } });
      if (path.endsWith("/manifests")) return route.fulfill({ json: [] });
      if (path.endsWith("/files")) {
        uploads++;
        if (uploads === 2) return route.fulfill({ status: 503, json: { message: "文件服务暂不可用，请稍后重试" } });
        return route.fulfill({ json: { id: `file-${uploads}` } });
      }
      if (path.endsWith("/attachments")) { associations++; return route.fulfill({ json: { id: "group-1" } }); }
      return route.fulfill({ json: path.endsWith("/batch-1") ? batch : [batch] });
    });
    await harness(page, "operating");
    await page.getByText("本地合成批次", { exact: true }).click();
    const panel = page.locator(".attachment-panel");
    await panel.getByPlaceholder("附件用途，例如：付款凭据、对账单").fill("现场原始资料");
    await panel.locator('input[type="file"]').setInputFiles([file, { ...file, name: "历史资料二.pdf" }]);
    await panel.getByRole("button", { name: "关联到批次", exact: true }).click();
    const error = panel.locator('[role="alert"]');
    await expect(error).toContainText("已保留所选文件");
    await expect(panel.getByText("历史资料二.pdf", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "重试上传", exact: true }).click();
    await expect(panel.getByText("附件已关联到接管批次", { exact: true })).toBeVisible();
    expect(uploads).toBe(3); expect(associations).toBe(1);
  });
  test(`经营接管草稿 ${width} 删除失败保留并可重试`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let deletes = 0;
    const batch = { id: "batch-1", batchNo: "待删除合成批次", status: "under_review", canDeleteDraft: true, revision: 1, totalRows: 0, readyRows: 0, blockedRows: 0, warningRows: 0, sceneKeys: [], rows: [], confirmations: [], activation: null };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path.endsWith("/projects")) return route.fulfill({ json: [{ id: "project-1", code: "TEST", name: "隔离测试项目" }] });
      if (path.endsWith("/capability")) return route.fulfill({ json: { projectId: "project-1", scenes: [], actions: {}, confirmationProfessions: {}, availableActions: ["file_upload"] } });
      if (path.endsWith("/manifests")) return route.fulfill({ json: [] });
      if (path.endsWith("/draft-deletion")) {
        deletes++;
        return deletes === 1 ? route.fulfill({ status: 409, json: { message: "草稿已变化，请刷新后重试" } }) : route.fulfill({ json: { id: batch.id, deleted: true } });
      }
      return route.fulfill({ json: path.endsWith("/batch-1") ? batch : [batch] });
    });
    await harness(page, "operating");
    await page.getByText(batch.batchNo, { exact: true }).click();
    await page.getByRole("button", { name: "删除批次草稿", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: "草稿已变化" })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认删除", exact: true })).toBeHidden();
    await page.getByRole("button", { name: "删除批次草稿", exact: true }).click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(page.getByRole("button", { name: "删除批次草稿", exact: true })).toBeHidden();
    await expect(page.getByText(batch.batchNo, { exact: true })).toBeHidden();
    expect(deletes).toBe(2);
  });
  for (const kind of ["expense", "procurement"]) {
    test(`草稿删除 ${width} ${kind} 确认与失败保留`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      let deletes = 0;
      await page.route("**/api/**", async route => {
        const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
        if (path.endsWith("/draft-deletion")) {
          deletes++;
          if (deletes === 1) return route.fulfill({ status: 409, json: { message: "草稿已变化，请刷新后重试" } });
          return route.fulfill({ json: { id: kind === "expense" ? "claim-1" : "procurement-1", deleted: true } });
        }
        if (path.endsWith("/capability")) return route.fulfill({ json: { claimId: "claim-1", availableActions: ["delete_expense_claim_draft"], removableAttachmentIds: [] } });
        return route.fulfill({ json: kind === "expense" ? {
          id: "claim-1", code: "TEST-01", claimType: "loan", status: "draft", canDeleteDraft: true, project: null,
          requestedAmountCents: "100", loanOffsetAmountCents: "0", companyPayableAmountCents: "0", fundedAmountCents: "0", updatedAt: "2026-10-19T00:00:00.000Z", entrySnapshots: [], lines: [], attachments: [], paymentExecutions: [], loanDisbursements: [], loanRepayments: [], paymentSubjectCompanyEntities: [], paymentSubjectPermissions: { canAdjust: false }, handledByName: "合成员工", applicantName: "合成员工", fundsPermissions: {}, reason: "合成草稿"
        } : {
          id: "procurement-1", code: "TEST-02", status: "draft", statusLabel: "草稿", canDeleteDraft: true, revision: 1, requestedAmountCents: "100", approvals: [], submissions: [], payments: [], paymentSummary: { availableAmountCents: "100", reservedAmountCents: "0" }, reason: "合成采购"
        } });
      });
      await harness(page, kind);
      await page.getByRole("button", { name: "删除草稿", exact: true }).click();
      await expect(page.getByRole("button", { name: "确认删除", exact: true })).toBeVisible();
      expect(deletes).toBe(0);
      await page.getByRole("button", { name: "保留草稿", exact: true }).click();
      await expect(page.getByRole("button", { name: "确认删除", exact: true })).toBeHidden();
      expect(deletes).toBe(0);
      await page.getByRole("button", { name: "删除草稿", exact: true }).click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      await expect(page.getByText(/草稿已变化/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "确认删除", exact: true })).toBeHidden();
      await page.getByRole("button", { name: "删除草稿", exact: true }).click();
      await page.getByRole("button", { name: "确认删除", exact: true }).click();
      await expect(page.getByText(kind === "expense" ? "已返回费用列表" : "已返回采购列表")).toBeVisible();
      expect(deletes).toBe(2);
    });
  }
}
