export {};

const { buildUserUpdate, initialTemporaryPassword, resolveTrialProjectName, trialUsers } = jest.requireActual("../../scripts/create-trial-users.cjs") as {
  buildUserUpdate: (
    user: { name: string; phone: string },
    passwordHash: string,
    resetExistingPassword: boolean
  ) => Record<string, unknown>;
  initialTemporaryPassword: (env: Record<string, string>) => string;
  resolveTrialProjectName: (env: Record<string, string>, projectId: string) => string;
  trialUsers: Array<{
    id: string;
    name: string;
    positionKey: string;
    globalPositionKeys?: string[];
  }>;
};

describe("create-trial-users script", () => {
  const user = { name: "试运行合同员一", phone: "18800000000" };

  it("preserves real self-service profile data and password when no reset is requested", () => {
    expect(buildUserUpdate(user, "new-hash", false)).toEqual({
      isActive: true
    });
  });

  it("resets trial user password only when the controlled reset switch is provided", () => {
    expect(buildUserUpdate(user, "new-hash", true)).toEqual({
      passwordHash: "new-hash",
      mustChangePassword: true,
      isActive: true
    });
  });

  it("requires the configured company initial password instead of generating one", () => {
    expect(() => initialTemporaryPassword({})).toThrow("INITIAL_USER_TEMPORARY_PASSWORD is required");
    expect(() =>
      initialTemporaryPassword({ INITIAL_USER_TEMPORARY_PASSWORD: "1234567" })
    ).toThrow("INITIAL_USER_TEMPORARY_PASSWORD must be at least 8 non-blank characters");
    expect(
      initialTemporaryPassword({ INITIAL_USER_TEMPORARY_PASSWORD: "  configured-password  " })
    ).toBe("configured-password");
  });

  it("defines Yang Jixu as chairman and global technical administrator without a project super admin", () => {
    expect(trialUsers.find((user) => user.id === "trial-user-chairman")).toMatchObject({
      name: "杨济旭",
      positionKey: "chairman",
      globalPositionKeys: ["chairman", "super_admin"]
    });
  });

  it("uses the real default project name for the seed trial project", () => {
    expect(resolveTrialProjectName({}, "seed-project-jgxm-001")).toBe(
      "昆明市2023年城市防洪排涝治理工程一-西山区新运粮河分洪工程设计施工总承包合同"
    );
    expect(resolveTrialProjectName({ TRIAL_PROJECT_NAME: "自定义项目" }, "project-2")).toBe("自定义项目");
  });
});
