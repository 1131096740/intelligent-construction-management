import { expect, test } from "@playwright/test";

test("桌面生成同源二维码并在手机端完成后刷新状态", async ({ page }) => {
  let statusReads = 0;
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "employee-1", name: "测试员工", phone: "13800000001", mustChangePassword: false, roleKeys: ["employee"], globalRoleKeys: ["employee"] },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/signature/ticket", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/me/signature/canvas-capabilities", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      availableActions: ["upload_canvas_signature", "create_canvas_signature_handoff"]
    })
  }));
  await page.route("**/api/me/signature/canvas-handoffs", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ token: "opaque-token", expiresAt: "2099-07-23T09:05:00.000Z" })
  }));
  await page.route("**/api/me/signature/canvas-handoffs/opaque-token", (route) => {
    statusReads += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        expiresAt: "2099-07-23T09:05:00.000Z",
        completedAt: statusReads >= 1 ? "2026-08-03T09:01:00.000Z" : null,
        signatureVersionId: statusReads >= 1 ? "version-1" : null,
        availableActions: []
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13800000001");
  await page.getByPlaceholder("请输入密码").fill("Jgzg@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/系统配置");

  await page.getByRole("button", { name: "生成手写签名二维码" }).click();
  await expect(page.getByAltText("手机手写签名二维码")).toBeVisible();
  await expect(page.getByText("手机端已完成手写签名，现在起可用于之后的审批。", { exact: true })).toBeVisible();
});

test("资料库只在服务端授权后打开敏感下载确认并提交原因", async ({ page }) => {
  let downloadTicketRequests = 0;
  let downloadCapabilityReads = 0;
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "employee-1", name: "测试员工", phone: "13800000001", mustChangePassword: false, roleKeys: ["employee"], globalRoleKeys: ["employee"] },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/archives", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [{
        id: "archive-1",
        documentNo: "GD-001",
        fileId: "archive-file-1",
        documentType: "合同归档件",
        businessRef: "HT-2026-001",
        project: "示范项目",
        fileSource: "双方最终签署版",
        fileSizeBytes: 1024,
        canDownload: true,
        disabledReason: null,
        archiveStatus: "已确认",
        statusTone: "success",
        uploadDepartment: "合同部",
        confirmedBy: "合同主管",
        lastAction: "刚刚"
      }],
      summary: { total: 1, contractArchives: 1, settlementArchives: 0, paymentFiles: 0, pending: 0 }
    })
  }));
  await page.route("**/api/files/archive-file-1/download-ticket-capability", (route) => {
    downloadCapabilityReads += 1;
    if (downloadCapabilityReads === 1) {
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ message: "当前账号无权下载该资料文件" })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ action: { key: "create_private_file_download_ticket", enabled: true } })
    });
  });
  await page.route("**/api/files/archive-file-1/download-ticket", async (route) => {
    downloadTicketRequests += 1;
    expect(route.request().postDataJSON()).toEqual({
      confirmationPassword: "current-password",
      downloadReason: "项目归档复核"
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ downloadUrl: "/files/download-tickets/ticket-1", expiresAt: "2099-07-23T09:05:00.000Z" })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13800000001");
  await page.getByPlaceholder("请输入密码").fill("Jgzg@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/资料库");

  await page.getByText("授权下载", { exact: true }).click();
  await expect(page.getByText("当前账号无权下载该资料文件", { exact: true })).toBeVisible();
  await expect(page.getByText("授权下载资料", { exact: true })).toHaveCount(0);
  await page.getByText("授权下载", { exact: true }).click();
  await expect(page.getByText("授权下载资料", { exact: true })).toBeVisible();
  const confirmButton = page.getByRole("button", { name: "生成下载链接" });
  await expect(confirmButton).toBeDisabled();
  await page.getByPlaceholder("请输入当前登录密码").fill("current-password");
  await page.getByPlaceholder("请填写本次下载用途").fill("项目归档复核");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect.poll(() => downloadTicketRequests).toBe(1);
  await expect(page.getByText("短时效下载链接已生成，后台已记录下载审计；链接过期后请重新授权下载。", { exact: true })).toBeVisible();
});
