import {
  CONTRACT_VERSION_STATUSES,
  PAYMENT_REQUEST_STATUSES,
  ROLE_KEYS,
  SETTLEMENT_STATUSES
} from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  configGroupById,
  dictionaryGroupById,
  readonlyConfigGroups,
  readonlyDictionaryGroups
} from "./system-governance-readonly.config";

describe("system governance readonly configuration", () => {
  it("lists every role from the shared domain role dictionary", () => {
    const roleGroup = dictionaryGroupById("roles");

    expect(roleGroup?.entries.map((entry) => entry.key)).toEqual(ROLE_KEYS);
    expect(roleGroup?.entries.find((entry) => entry.key === "super_admin")).toMatchObject({
      label: "系统管理员",
      description: "技术管理角色，不参与业务审批。"
    });
  });

  it("keeps status dictionaries aligned with shared domain enums", () => {
    expect(dictionaryGroupById("contract_status")?.entries.map((entry) => entry.key)).toEqual(
      CONTRACT_VERSION_STATUSES
    );
    expect(dictionaryGroupById("settlement_status")?.entries.map((entry) => entry.key)).toEqual(
      SETTLEMENT_STATUSES
    );
    expect(dictionaryGroupById("payment_status")?.entries.map((entry) => entry.key)).toEqual(
      PAYMENT_REQUEST_STATUSES
    );
  });

  it("documents reimbursement and spot purchase as project expense dictionaries", () => {
    const projectExpenseGroup = dictionaryGroupById("project_expense");

    expect(projectExpenseGroup?.entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["reimbursement", "spot_purchase"])
    );
    expect(projectExpenseGroup?.entries.find((entry) => entry.key === "spot_purchase")).toMatchObject({
      label: "零星采购"
    });
  });

  it("documents contract workbench and takeover evidence file purposes", () => {
    const filePurposeKeys = dictionaryGroupById("file_purpose")?.entries.map((entry) => entry.key);

    expect(filePurposeKeys).toEqual(
      expect.arrayContaining([
        "draft",
        "negotiation",
        "internal_review",
        "historical_contract_scan",
        "historical_settlement_ledger",
        "historical_payment_voucher",
        "other"
      ])
    );
  });

  it("shows read-only login, download, upload, and notification configuration groups", () => {
    expect(readonlyConfigGroups.map((group) => group.id)).toEqual([
      "login",
      "file_download",
      "upload_limit",
      "notification"
    ]);
    expect(configGroupById("file_download")?.items.map((item) => item.value)).toContain(
      "当前密码 + 下载原因"
    );
    expect(configGroupById("notification")?.items.map((item) => item.value)).toContain("QQ 邮箱 SMTP");
  });

  it("keeps dictionaries read-only by exposing display entries only", () => {
    const dictionaryEntry = readonlyDictionaryGroups[0]?.entries[0];
    const configItem = readonlyConfigGroups[0]?.items[0];

    expect(Object.keys(dictionaryEntry ?? {}).sort()).toEqual(["description", "key", "label"]);
    expect(Object.keys(configItem ?? {}).sort()).toEqual(["description", "name", "value"]);
  });
});
