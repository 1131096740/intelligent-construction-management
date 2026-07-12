import { expect, test } from "@playwright/test";

test("已发布模板结构可预览、精确带入向导且全程零模板写入", async ({ page }) => {
  const templates = [
    {
      id: "template-full",
      code: "TPL-MAT-FULL",
      name: "材料采购标准模板",
      status: "published",
      contractTypeKey: "material_purchase",
      versionId: "version-full-2",
      versionNo: 2,
      usagePreview: {
        fields: [
          {
            label: "供应商名称",
            type: "text",
            required: true,
            group: "主体信息",
            conditional: false
          }
        ],
        bills: [
          {
            name: "材料清单",
            amountRole: "included",
            pricingMode: "tax_inclusive",
            columns: [{ label: "材料名称", type: "text", required: true }]
          }
        ],
        clauses: [{ title: "付款约定", required: true }],
        attachments: [{ name: "报价单", required: true, mustBeValid: true }],
        validations: [{ level: "block", message: "请补齐付款约定" }]
      }
    },
    {
      id: "template-simple",
      code: "TPL-MAT-SIMPLE",
      name: "材料采购简版模板",
      status: "published",
      contractTypeKey: "material_purchase",
      versionId: "version-simple-1",
      versionNo: 1,
      usagePreview: {
        fields: [
          {
            label: "交货地点",
            type: "text",
            required: false,
            conditional: true
          }
        ],
        bills: [],
        clauses: [],
        attachments: [],
        validations: []
      }
    }
  ];
  let templateMutations = 0;
  let layoutOrFileCalls = 0;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "contract-staff-1",
          name: "合同经办人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["contract_staff"],
          globalRoleKeys: ["contract_staff"]
        },
        tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      })
    })
  );
  await page.route("**/api/contract-templates*", (route) => {
    if (route.request().method() !== "GET") {
      templateMutations += 1;
      return route.abort();
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(templates) });
  });
  await page.route("**/api/contract-template-versions/**", (route) => {
    templateMutations += 1;
    return route.abort();
  });
  await page.route("**/api/contract-layout-templates*", (route) => {
    layoutOrFileCalls += 1;
    return route.abort();
  });
  await page.route("**/api/files/**", (route) => {
    layoutOrFileCalls += 1;
    return route.abort();
  });
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "XM-001", name: "科技园项目" }])
    })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.getByText("合同模板库", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "合同模板库" })).toBeVisible();

  const fullTemplateCard = page.locator(".template-card").filter({ hasText: "材料采购标准模板" });
  await fullTemplateCard.getByRole("button", { name: "预览模板内容" }).click();
  const drawer = page.locator(".t-drawer");
  await expect(drawer.getByText("业务结构预览（非合同正文/版式 PDF）")).toBeVisible();
  await expect(drawer.getByText("供应商名称", { exact: true })).toBeVisible();
  await expect(drawer.getByText("材料清单", { exact: true })).toBeVisible();
  await expect(drawer.getByText("付款约定", { exact: true })).toBeVisible();
  await expect(drawer.getByText("报价单", { exact: true })).toBeVisible();
  await expect(drawer.getByPlaceholder("请输入当前登录密码")).toHaveCount(0);
  await drawer.getByRole("button", { name: "用此模板建合同" }).click();

  await expect(page.getByRole("heading", { name: "新建合同" })).toBeVisible();
  await expect(page.getByRole("button", { name: "预览所选模板" })).toBeEnabled();
  const currentUrl = new URL(page.url());
  expect(currentUrl.searchParams.get("contractType")).toBe("material_purchase");
  expect(currentUrl.searchParams.get("templateVersionId")).toBe("version-full-2");

  await page.getByRole("button", { name: "预览所选模板" }).click();
  await expect(page.locator(".t-drawer").getByText("供应商名称", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("业务结构预览（非合同正文/版式 PDF）")).toBeHidden();
  await page.locator(".template-choice .t-select").click();
  await page.locator(".t-select__dropdown:visible").getByText("材料采购简版模板", { exact: true }).click();
  await page.getByRole("heading", { name: "新建合同" }).click();
  await expect(page.getByText("业务结构预览（非合同正文/版式 PDF）")).toBeHidden();
  await page.getByRole("button", { name: "预览所选模板" }).click();
  await expect(page.locator(".t-drawer").getByText("交货地点", { exact: true })).toBeVisible();
  await expect(page.locator(".t-drawer").getByText("供应商名称", { exact: true })).toHaveCount(0);

  expect(templateMutations).toBe(0);
  expect(layoutOrFileCalls).toBe(0);
});
