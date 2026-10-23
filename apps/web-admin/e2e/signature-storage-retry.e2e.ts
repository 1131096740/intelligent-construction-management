import { expect, test } from "@playwright/test";

for (const role of ["employee", "project_manager"]) {
  for (const handoff of [false, true]) {
    test(role + (handoff ? " 扫码签名" : " 手机直接登录签名") + "失败保留笔迹并原样重试", async ({ page }, testInfo) => {
      let uploads = 0;
      await page.route("**/api/**", route => new URL(route.request().url()).pathname.startsWith("/api/")
        ? route.fulfill({ contentType: "application/json", body: "[]" }) : route.continue());
      await page.route("**/api/auth/login", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({
        user: { id: "synthetic-employee", name: "合成签名验收员工", phone: "13800000001", mustChangePassword: false,
          roleKeys: [role], globalRoleKeys: role === "employee" ? ["employee"] : [] },
        tokens: { accessToken: "synthetic-token", refreshToken: "synthetic-refresh", expiresIn: 900 }
      }) }));
      await page.route("**/api/me/signature/ticket", route => route.fulfill({ contentType: "application/json", body: "null" }));
      await page.route("**/api/me/signature/canvas-capabilities", route => route.fulfill({ contentType: "application/json",
        body: JSON.stringify({ availableActions: ["upload_canvas_signature", "create_canvas_signature_handoff"] }) }));
      await page.route("**/api/me/signature/canvas-handoffs/synthetic-token", route => route.fulfill({ contentType: "application/json",
        body: JSON.stringify({ completedAt: null, availableActions: ["complete_canvas_signature_handoff"] }) }));
      const endpoint = handoff ? "**/api/me/signature/canvas-handoffs/synthetic-token/complete" : "**/api/me/signature/canvas";
      await page.route(endpoint, async route => {
        // WebKit interception omits multipart bytes. signature-real.e2e.ts
        // verifies the actual PNG and retry digests at the receiving backend.
        uploads += 1;
        await route.fulfill({ status: uploads === 1 ? 503 : 201, contentType: "application/json",
          body: JSON.stringify(uploads === 1
            ? { message: "资料存储服务当前受限，暂时无法上传。请联系管理员检查服务状态，恢复后重试。" }
            : { signatureFileId: "synthetic-file", signatureVersionId: "synthetic-version" }) });
      });
      await page.goto("/login");
      await page.getByPlaceholder("请输入手机号").fill("13800000001");
      await page.getByPlaceholder("请输入密码").fill("Synthetic@2026");
      await page.getByRole("button", { name: "登录" }).click();
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(handoff ? "/手写签名?handoff=synthetic-token" : "/系统配置");
      await page.getByRole("button", { name: "全屏手写签名", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "全屏手写签名", exact: true });
      await dialog.getByRole("button", { name: "开始签名", exact: true }).click();
      const pad = dialog.getByLabel("横向手写签字板");
      await expect(pad).toBeVisible();
      await pad.click({ trial: true });
      const box = (await pad.boundingBox())!;
      for (const [type, x, y] of [["pointerdown", 0.7, 0.2], ["pointermove", 0.3, 0.5], ["pointermove", 0.6, 0.8], ["pointerup", 0.6, 0.8]] as const) {
        await pad.dispatchEvent(type, { pointerId: 1, isPrimary: true, pointerType: "touch", clientX: box.x + box.width * x, clientY: box.y + box.height * y });
      }
      const before = await pad.evaluate(node => (node as HTMLCanvasElement).toDataURL());
      await dialog.getByRole("button", { name: "预览签名", exact: true }).click();
      const preview = dialog.getByAltText("待保存手写签名", { exact: true });
      await expect(preview).toBeVisible();
      const previewSource = await preview.getAttribute("src");
      const save = dialog.getByRole("button", { name: "保存手写签名", exact: true });
      await save.click();
      const message = dialog.getByText("签名未保存，笔迹已保留。资料存储服务当前受限，暂时无法上传。请联系管理员检查服务状态，恢复后重试。", { exact: true });
      await expect(message).toBeVisible();
      await expect(save).toBeEnabled();
      await expect(preview).toHaveAttribute("src", previewSource!);
      expect(await pad.evaluate(node => (node as HTMLCanvasElement).toDataURL())).toBe(before);
      await page.screenshot({ path: testInfo.outputPath("signature-failure-retained.png"), fullPage: true });
      await save.click();
      await expect(page.getByText(handoff ? "手写签名已完成，请回到电脑端继续。" : "手写签名已保存，将用于之后的审批。", { exact: true })).toBeVisible();
      expect(uploads).toBe(2);
    });
  }
}
