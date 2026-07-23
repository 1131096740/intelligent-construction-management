import { expect, test } from "@playwright/test";

test("本人可在设置页直接手写并提交透明 PNG 签名", async ({ page }) => {
  let saved = 0;
  await page.route("**/api/**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([])
  }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "employee-1",
        name: "测试员工",
        phone: "13800000001",
        mustChangePassword: false,
        roleKeys: ["employee"],
        globalRoleKeys: ["employee"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/signature/ticket", (route) => route.fulfill({
    contentType: "application/json",
    body: "null"
  }));
  await page.route("**/api/me/signature/canvas", async (route) => {
    saved += 1;
    expect(await route.request().headerValue("content-type")).toContain("multipart/form-data");
    expect(route.request().postDataBuffer()).toBeTruthy();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ signatureFileId: "canvas-file-1", signatureVersionId: "canvas-version-1" })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13800000001");
  await page.getByPlaceholder("请输入密码").fill("Jgzg@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/系统配置");
  await expect(page.getByText("个人签名", { exact: true })).toBeVisible();

  const pad = page.getByLabel("横向手写签字板");
  const box = await pad.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 60, box!.y + 80);
  await page.mouse.down();
  await page.mouse.move(box!.x + 130, box!.y + 125, { steps: 8 });
  await page.mouse.move(box!.x + 220, box!.y + 70, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "保存手写签名" })).toBeEnabled();
  await page.getByRole("button", { name: "保存手写签名" }).click();
  await expect.poll(() => saved).toBe(1);
  await expect(page.getByText("手写签名已保存，将用于之后的审批。", { exact: true })).toBeVisible();
});
