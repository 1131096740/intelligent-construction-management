const { buildUserUpdate } = jest.requireActual("../../scripts/create-trial-users.cjs") as {
  buildUserUpdate: (
    user: { name: string; phone: string },
    passwordHash: string,
    resetExistingPassword: boolean
  ) => Record<string, unknown>;
};

describe("create-trial-users script", () => {
  const user = { name: "试运行合同员一", phone: "18800000000" };

  it("preserves existing trial user password when no explicit reset password is provided", () => {
    expect(buildUserUpdate(user, "new-hash", false)).toEqual({
      name: "试运行合同员一",
      phone: "18800000000",
      mustChangePassword: true,
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
});
