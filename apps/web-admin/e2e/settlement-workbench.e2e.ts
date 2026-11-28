import { expect, test } from "@playwright/test";
import { selectSignedContract, settlementNumberField, signedSettlementFixture, signedSettlementUrl, syntheticPdf } from "./helpers/signed-settlement-fixture";

test("旧入口无草稿坐标时转到现行已签结算", async ({ page }) => {
  const calls = await signedSettlementFixture(page);
  await page.goto("/结算工作台/新建?project=project-1");
  await expect(page.getByRole("heading", { name: "已签结算登记" })).toBeVisible();
  await expect.poll(() => decodeURI(new URL(page.url()).pathname)).toBe("/结算工作台/已签登记");
  expect(calls.legacy).toEqual([]);
});

test("同合同同号提示后仍可提交，负数进入现行主管复核", async ({ page }) => {
  const calls = await signedSettlementFixture(page);
  await page.goto(signedSettlementUrl);
  await selectSignedContract(page);
  await settlementNumberField(page).fill("JS-DUP");
  await page.getByPlaceholder("最多四位小数，可填负数").fill("-25.5001");
  await expect(page.getByText("预计累计：74.4999 元")).toBeVisible();
  await page.getByLabel("选择已签 PDF 或照片").setInputFiles(syntheticPdf("signed.pdf"));
  await expect(page.getByText("signed.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交主管复核" }).click();
  await expect(page.getByText("已提交主管复核。该合同已有同号结算，请核对原单")).toBeVisible();
  expect(calls.save).toEqual([{ method: "POST", body: {
    contractKind: "downstream", contractId: "contract-1", number: "JS-DUP", amountYuan: "-25.5001", fileIds: ["uploaded-1"]
  } }]);
  expect(calls.submissions).toEqual([1]);
  expect(calls.legacy).toEqual([]);
});

test("被驳回的已签结算按原记录修订后重新提交", async ({ page }) => {
  const calls = await signedSettlementFixture(page, "returned");
  await page.goto(`${signedSettlementUrl}&settlementId=signed-1`);
  await expect(page.getByText("请核对已签金额")).toBeVisible();
  await page.getByPlaceholder("最多四位小数，可填负数").fill("40.1250");
  await page.getByRole("button", { name: "提交主管复核" }).click();
  await expect(page.getByText("已提交主管复核")).toBeVisible();
  expect(calls.save).toEqual([{ method: "PATCH", body: {
    revision: 3, contractKind: "downstream", contractId: "contract-1", number: "JS-01", amountYuan: "40.1250", fileIds: ["original-1"]
  } }]);
  expect(calls.submissions).toEqual([4]);
  expect(calls.legacy).toEqual([]);
});
