import { freezeSettlementParticipants } from "./settlement-participant-freeze";

const activeMembers = [
  { projectId: "project-1", userId: "material-1", roleKey: "material_staff", userIsActive: true },
  { projectId: "project-1", userId: "foreman-1", roleKey: "engineering_foreman", userIsActive: true },
  { projectId: "project-1", userId: "tech-1", roleKey: "engineering_tech", userIsActive: true },
  { projectId: "project-1", userId: "chief-1", roleKey: "engineering_director", userIsActive: true }
];

describe("freezeSettlementParticipants", () => {
  it.each(["material_purchase", "equipment_rental"] as const)(
    "freezes one active project material staff member for %s",
    async (contractTypeKey) => {
      await expect(freezeSettlementParticipants({
        contractTypeKey,
        projectId: "project-1",
        selectedUserId: "material-1",
        projectMembers: activeMembers
      })).resolves.toEqual({
        fieldReviewerUserId: "material-1",
        fieldReviewerRoleKey: "material_staff",
        engineeringDirectorUserId: null
      });
    }
  );

  it.each([
    ["labor_subcontract", "foreman-1", "engineering_foreman"],
    ["professional_subcontract", "tech-1", "engineering_tech"]
  ] as const)(
    "freezes the selected field reviewer and unique project chief engineer for %s",
    async (contractTypeKey, selectedUserId, expectedRoleKey) => {
      await expect(freezeSettlementParticipants({
        contractTypeKey,
        projectId: "project-1",
        selectedUserId,
        projectMembers: activeMembers
      })).resolves.toEqual({
        fieldReviewerUserId: selectedUserId,
        fieldReviewerRoleKey: expectedRoleKey,
        engineeringDirectorUserId: "chief-1"
      });
    }
  );

  it("rejects a missing selection", async () => {
    await expect(freezeSettlementParticipants({
      contractTypeKey: "labor_subcontract",
      projectId: "project-1",
      selectedUserId: null,
      projectMembers: activeMembers
    })).rejects.toThrow("请选择所属项目当前有效人员");
  });

  it.each([
    ["a member of another project", "other-project", true],
    ["an inactive user", "project-1", false]
  ])("rejects %s", async (_label, memberProjectId, userIsActive) => {
    await expect(freezeSettlementParticipants({
      contractTypeKey: "material_purchase",
      projectId: "project-1",
      selectedUserId: "selected-1",
      projectMembers: [{
        projectId: memberProjectId,
        userId: "selected-1",
        roleKey: "material_staff",
        userIsActive
      }]
    })).rejects.toThrow("只能选择所属项目当前有效人员");
  });

  it.each([
    ["material_purchase", "engineering_foreman"],
    ["equipment_rental", "engineering_tech"],
    ["labor_subcontract", "material_staff"],
    ["professional_subcontract", "engineering_director"]
  ] as const)("rejects role %s/%s outside the governed mapping", async (contractTypeKey, roleKey) => {
    await expect(freezeSettlementParticipants({
      contractTypeKey,
      projectId: "project-1",
      selectedUserId: "selected-1",
      projectMembers: [
        { projectId: "project-1", userId: "selected-1", roleKey, userIsActive: true },
        { projectId: "project-1", userId: "chief-1", roleKey: "engineering_director", userIsActive: true }
      ]
    })).rejects.toThrow("所选人员岗位不符合当前结算类型");
  });

  it("rejects an ambiguous selected field role instead of guessing which role to freeze", async () => {
    await expect(freezeSettlementParticipants({
      contractTypeKey: "labor_subcontract",
      projectId: "project-1",
      selectedUserId: "multi-role-1",
      projectMembers: [
        { projectId: "project-1", userId: "multi-role-1", roleKey: "engineering_foreman", userIsActive: true },
        { projectId: "project-1", userId: "multi-role-1", roleKey: "engineering_tech", userIsActive: true },
        { projectId: "project-1", userId: "chief-1", roleKey: "engineering_director", userIsActive: true }
      ]
    })).rejects.toThrow("所选人员岗位不符合当前结算类型");
  });

  it.each([
    ["has no active project chief engineer", []],
    ["has conflicting active project chief engineers", ["chief-1", "chief-2"]]
  ])("rejects labor settlement when the project %s", async (_label, chiefEngineerIds) => {
    await expect(freezeSettlementParticipants({
      contractTypeKey: "labor_subcontract",
      projectId: "project-1",
      selectedUserId: "foreman-1",
      projectMembers: [
        { projectId: "project-1", userId: "foreman-1", roleKey: "engineering_foreman", userIsActive: true },
        ...chiefEngineerIds.map((userId) => ({
          projectId: "project-1",
          userId,
          roleKey: "engineering_director",
          userIsActive: true
        }))
      ]
    })).rejects.toThrow("所属项目的项目总工配置缺失或冲突");
  });

  it("ignores inactive and other-project chief engineers when enforcing uniqueness", async () => {
    await expect(freezeSettlementParticipants({
      contractTypeKey: "professional_subcontract",
      projectId: "project-1",
      selectedUserId: "tech-1",
      projectMembers: [
        ...activeMembers,
        { projectId: "project-1", userId: "chief-inactive", roleKey: "engineering_director", userIsActive: false },
        { projectId: "project-2", userId: "chief-other", roleKey: "engineering_director", userIsActive: true }
      ]
    })).resolves.toMatchObject({ engineeringDirectorUserId: "chief-1" });
  });

  it("fails closed for an unsupported contract type", async () => {
    await expect(freezeSettlementParticipants({
      contractTypeKey: "generic_contract",
      projectId: "project-1",
      selectedUserId: "material-1",
      projectMembers: activeMembers
    })).rejects.toThrow("当前合同类型不支持受治理结算参与人冻结");
  });
});
