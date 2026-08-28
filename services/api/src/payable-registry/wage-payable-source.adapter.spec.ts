import {
  PayableSourceAdapterRegistry,
  WagePayableSourceAdapter,
  deriveEffectiveWagePayableAmount
} from "./wage-payable-source.adapter";

describe("WagePayableSourceAdapter", () => {
  it("keeps the payable source registry closed and complete for registered adapters", () => {
    const adapter = new WagePayableSourceAdapter();
    const registry = new PayableSourceAdapterRegistry([adapter], ["wage_payable_ref"]);

    expect(registry.list()).toEqual([adapter]);
    expect(registry.require("wage_payable_ref")).toBe(adapter);
    expect(() => registry.require("unregistered_source")).toThrow("缺少应付来源适配器");
    expect(() => new PayableSourceAdapterRegistry([adapter, adapter])).toThrow("应付来源适配器重复");
    expect(() => new PayableSourceAdapterRegistry([], ["wage_payable_ref"]).assertComplete())
      .toThrow("缺少应付来源适配器");
  });

  it("publishes only an immutable opaque wage reference and never infers a source by name, date or amount", () => {
    const adapter = new WagePayableSourceAdapter();

    expect(
      adapter.toRegisteredPayable({
        id: "6b1e37ea-6c7e-4af9-8a52-b9ccbe7701dd",
        confirmedVersionId: "wage-version-1",
        confirmedVersion: { status: "confirmed" },
        projectAllocationId: "allocation-1",
        creditorBreakdownId: "creditor-1",
        debtorCompanyId: "company-1",
        projectId: "project-1",
        amountCents: 12_345n,
        direction: "increase",
        debtorCompanySnapshot: { companyId: "company-1" },
        projectSnapshot: { projectId: "project-1", serviceSnapshotId: "service-1" },
        creditorBreakdown: {
          creditorSubjectType: "business_party",
          creditorSubjectIdentityKey: "business-party-version-1",
          creditorNameSnapshot: "劳务公司甲"
        },
        creditorSnapshot: {
          subjectType: "business_party",
          identityKey: "business-party-version-1",
          name: "劳务公司甲",
          unifiedIdentity: "91310000TEST000001",
          versionFingerprint: "fingerprint-1",
          category: "labor_service_company"
        }
      })
    ).toEqual({
      payableRef: "6b1e37ea-6c7e-4af9-8a52-b9ccbe7701dd",
      sourceType: "wage_payable_ref",
      sourceAggregateId: "wage-version-1",
      sourceLineId: "6b1e37ea-6c7e-4af9-8a52-b9ccbe7701dd",
      confirmedVersionId: "wage-version-1",
      debtorCompanyId: "company-1",
      payeeSubjectType: "business_party",
      payeeSubjectId: "business-party-version-1",
      currencyCode: "CNY",
      beneficiaryProjectId: "project-1",
      confirmedAmountCents: 12_345n
    });
  });

  it("fails closed for a negative adjustment because it is not itself a payable available for a new allocation", () => {
    const adapter = new WagePayableSourceAdapter();

    expect(() =>
      adapter.toRegisteredPayable({
        id: "negative-ref",
        confirmedVersionId: "wage-version-2",
        confirmedVersion: { status: "confirmed" },
        projectAllocationId: "allocation-2",
        creditorBreakdownId: "creditor-2",
        debtorCompanyId: "company-1",
        projectId: "project-1",
        amountCents: 1n,
        direction: "decrease",
        debtorCompanySnapshot: { companyId: "company-1" },
        projectSnapshot: { projectId: "project-1" },
        creditorSnapshot: {
          subjectType: "employee_user",
          identityKey: "user-1"
        }
      })
    ).toThrow("工资应付调整引用不能直接用于新增核销");
  });

  it("fails closed for a positive correction line too, because only its immutable root is a registry payable", () => {
    const adapter = new WagePayableSourceAdapter();

    expect(() =>
      adapter.toRegisteredPayable({
        id: "positive-adjustment-ref",
        confirmedVersionId: "wage-version-3",
        confirmedVersion: { status: "confirmed" },
        projectAllocationId: "allocation-3",
        creditorBreakdownId: "creditor-3",
        debtorCompanyId: "company-1",
        projectId: "project-1",
        amountCents: 1n,
        direction: "increase",
        adjustsPayableRefId: "root-ref",
        debtorCompanySnapshot: { companyId: "company-1" },
        projectSnapshot: { projectId: "project-1" },
        creditorSnapshot: {
          subjectType: "employee_user",
          identityKey: "user-1"
        }
      })
    ).toThrow("工资应付调整引用不能直接用于新增核销");
  });

  it("derives the root payable effective amount from append-only corrections without mutating the original confirmed amount", () => {
    expect(
      deriveEffectiveWagePayableAmount(10_000n, [
        { direction: "increase", amountCents: 2_500n },
        { direction: "decrease", amountCents: 4_000n }
      ])
    ).toBe(8_500n);
  });

  it("fails closed when a queried wage version is not confirmed", () => {
    expect(() =>
      new WagePayableSourceAdapter().toRegisteredPayable({
        id: "draft-version-ref", confirmedVersionId: "wage-version-draft", projectAllocationId: "allocation-4", creditorBreakdownId: "creditor-4",
        debtorCompanyId: "company-1", projectId: "project-1", amountCents: 1n, direction: "increase",
        confirmedVersion: { status: "draft" }, debtorCompanySnapshot: { companyId: "company-1" }, projectSnapshot: { projectId: "project-1" },
        creditorSnapshot: { subjectType: "employee_user", identityKey: "user-1" }
      })
    ).toThrow("工资应付引用尚未确认");
  });

  it("fails closed when the confirmed wage version relation is absent", () => {
    expect(() =>
      new WagePayableSourceAdapter().toRegisteredPayable({
        id: "missing-version-relation",
        confirmedVersionId: "wage-version-missing",
        projectAllocationId: "allocation-missing",
        creditorBreakdownId: "creditor-missing",
        debtorCompanyId: "company-1",
        projectId: "project-1",
        amountCents: 1n,
        direction: "increase",
        debtorCompanySnapshot: { companyId: "company-1" },
        projectSnapshot: { projectId: "project-1" },
        creditorSnapshot: { subjectType: "employee_user", identityKey: "user-1" }
      })
    ).toThrow("工资应付引用尚未确认");
  });

  it("fails closed when the frozen creditor snapshot drifts from the authoritative creditor breakdown", () => {
    expect(() =>
      new WagePayableSourceAdapter().toRegisteredPayable({
        id: "drifted-ref",
        confirmedVersionId: "wage-version-4",
        confirmedVersion: { status: "confirmed" },
        projectAllocationId: "allocation-4",
        creditorBreakdownId: "creditor-4",
        debtorCompanyId: "company-1",
        projectId: "project-1",
        amountCents: 1n,
        direction: "increase",
        debtorCompanySnapshot: { companyId: "company-1" },
        projectSnapshot: { projectId: "project-1" },
        creditorBreakdown: {
          creditorSubjectType: "business_party",
          creditorSubjectIdentityKey: "business-party-version-1",
          creditorNameSnapshot: "劳务公司甲"
        },
        creditorSnapshot: {
          subjectType: "business_party",
          identityKey: "business-party-version-2",
          name: "劳务公司甲"
        }
      })
    ).toThrow("工资债权人快照与确认明细不一致");
  });
});
