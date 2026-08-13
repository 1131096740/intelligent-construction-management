import "reflect-metadata";
import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import { ProjectExpenseController } from "../project-expense/project-expense.controller";
import { ProjectController } from "./project.controller";

describe("project stage D capability controller wiring", () => {
  it.each(["createCapability", "updateCapability"])(
    "keeps %s aligned with project maintenance positions",
    (method) => {
      const handler = (ProjectController.prototype as unknown as Record<string, object>)[method];
      expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, handler)).toEqual([
        "chairman",
        "general_manager"
      ]);
    }
  );

  it.each([
    ["upstreamFundRecordCapability", "project.upstream_fund_fact.record"],
    ["upstreamFundConfirmationCapability", "project.upstream_fund_fact.confirm"],
    ["uploadUpstreamFundPrivateFile", "project.upstream_fund_fact.record"],
    ["uploadAffiliateContractPrivateFile", "project.affiliate_contract_fact.record"],
    ["uploadAffiliateSettlementPrivateFile", "project.affiliate_settlement_fact.record"],
    ["uploadAffiliatePaymentPrivateFile", "project.affiliate_payment_fact.record"],
    [
      "uploadAffiliateBusinessEvidencePrivateFile",
      "project.affiliate_business_fact.evidence_supplement"
    ],
    ["updateOperatingProfile", "project.operating_profile.manage"],
    ["participatingCompanyOptions", "project.operating_profile.manage"],
    ["constructionEnterpriseOptions", "project.operating_profile.manage"],
    ["assignConstructionEnterprise", "project.operating_profile.manage"],
    ["addParticipatingCompany", "project.operating_profile.manage"],
    ["deactivateParticipatingCompany", "project.operating_profile.manage"],
    ["removeParticipatingCompany", "project.operating_profile.manage"],
    ["assignAffiliate", "project.operating_profile.manage"]
  ])("guards %s with %s", (method, action) => {
    const handler = (ProjectController.prototype as unknown as Record<string, object>)[method];
    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it("keeps operating-profile input DTOs as runtime validation metatypes", () => {
    const updateTypes = Reflect.getMetadata(
      "design:paramtypes",
      ProjectController.prototype,
      "updateOperatingProfile"
    );
    const participantTypes = Reflect.getMetadata(
      "design:paramtypes",
      ProjectController.prototype,
      "addParticipatingCompany"
    );
    expect(updateTypes).toEqual(expect.arrayContaining([expect.any(Function)]));
    expect(participantTypes).toEqual(expect.arrayContaining([expect.any(Function)]));
  });

  it.each([
    ["createCapability", "project_expense.create"],
    ["uploadCreatePrivateFile", "project_expense.create"]
  ])("guards expense %s with %s", (method, action) => {
    const handler = (ProjectExpenseController.prototype as unknown as Record<string, object>)[
      method
    ];
    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler)).toBe(action);
  });

  it("derives expense action capability in the service instead of a coarse decorator", () => {
    expect(
      Reflect.getMetadata(
        REQUIRED_PROJECT_ACTION_KEY,
        ProjectExpenseController.prototype.actionCapability
      )
    ).toBeUndefined();
  });

  it("rejects affiliate evidence upload before the file service stores anything", async () => {
    const denied = new Error("当前岗位不能为该挂靠外部事实补充依据");
    const affiliateBusiness = {
      assertEvidenceUploadAllowed: jest.fn().mockRejectedValue(denied)
    };
    const files = { uploadPrivateFile: jest.fn() };
    const controller = new ProjectController(
      {} as never,
      affiliateBusiness as never,
      undefined,
      files as never
    );

    await expect(
      controller.uploadAffiliateBusinessEvidencePrivateFile(
        "project-1",
        "contract-fact-1",
        {
          originalname: "evidence.pdf",
          mimetype: "application/pdf",
          size: 8,
          buffer: Buffer.from("evidence")
        },
        { id: "employee-1" } as never,
        "contract"
      )
    ).rejects.toBe(denied);
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();
  });
});
