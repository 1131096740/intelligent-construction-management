const { buildUserUpdate, resolveTrialProjectName } = jest.requireActual("../../scripts/create-trial-users.cjs") as {
  buildUserUpdate: (
    user: { name: string; phone: string },
    passwordHash: string,
    resetExistingPassword: boolean
  ) => Record<string, unknown>;
  resolveTrialProjectName: (env: Record<string, string>, projectId: string) => string;
};

describe("create-trial-users script", () => {
  const user = { name: "试运行合同员一", phone: "18800000000" };

  it("preserves existing trial user password and change-password flag when no explicit reset password is provided", () => {
    expect(buildUserUpdate(user, "new-hash", false)).toEqual({
      name: "试运行合同员一",
      phone: "18800000000",
      isActive: true
    });
  });

  it("resets trial user password when TRIAL_USER_TEMP_PASSWORD is provided", () => {
    expect(buildUserUpdate(user, "new-hash", true)).toEqual({
      name: "试运行合同员一",
      phone: "18800000000",
      passwordHash: "new-hash",
      mustChangePassword: true,
      isActive: true
    });
  });

  it("uses the real default project name for the seed trial project", () => {
    expect(resolveTrialProjectName({}, "seed-project-jgxm-001")).toBe(
      "昆明市2023年城市防洪排涝治理工程一-西山区新运粮河分洪工程设计施工总承包合同"
    );
    expect(resolveTrialProjectName({ TRIAL_PROJECT_NAME: "自定义项目" }, "project-2")).toBe("自定义项目");
  });
});
