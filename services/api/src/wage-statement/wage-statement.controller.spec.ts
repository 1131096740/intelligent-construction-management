import "reflect-metadata";

import { REQUIRED_POSITIONS_KEY } from "../auth/decorators/require-positions.decorator";
import { WageStatementController } from "./wage-statement.controller";

describe("WageStatementController aggregate reads", () => {
  it("routes the three aggregate-only read endpoints with the authenticated user identity", async () => {
    const wages = {
      listWorkbench: jest.fn().mockResolvedValue({ items: [] }),
      readSummary: jest.fn().mockResolvedValue({}),
      readImportPreview: jest.fn().mockResolvedValue({})
    };
    const controller = new WageStatementController(wages as never, {} as never);
    const user = { id: "finance-user" };

    await controller.workbench(user as never);
    await controller.summary(user as never, "statement-1");
    await controller.importPreview(user as never, "statement-1");

    expect(wages.listWorkbench).toHaveBeenCalledWith("finance-user");
    expect(wages.readSummary).toHaveBeenCalledWith("finance-user", "statement-1");
    expect(wages.readImportPreview).toHaveBeenCalledWith("finance-user", "statement-1");
  });
});

describe("WageStatementController wage workbench governance", () => {
  it("exposes a separately readable capability snapshot and applies the frozen position boundary to every route", async () => {
    const wages = { capabilities: jest.fn().mockResolvedValue({ canPrepare: true, canSubmit: true, canReturn: false, canConfirm: false }) };
    const controller = new WageStatementController(wages as never, {} as never);

    await expect(controller.capabilities({ id: "finance-user" } as never)).resolves.toEqual({
      canPrepare: true,
      canSubmit: true,
      canReturn: false,
      canConfirm: false
    });
    expect(wages.capabilities).toHaveBeenCalledWith("finance-user");

    for (const method of ["capabilities", "workbench", "summary", "importPreview", "createSensitiveExportTicket", "createApprovedSource", "createDraft", "createRevision", "submit"] as const) {
      expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, WageStatementController.prototype[method])).toEqual([
        "finance_staff",
        "finance_director"
      ]);
    }
    for (const method of ["returnForReview", "confirm"] as const) {
      expect(Reflect.getMetadata(REQUIRED_POSITIONS_KEY, WageStatementController.prototype[method])).toEqual(["finance_director"]);
    }
  });

  it("reauthenticates before issuing the separately audited sensitive export ticket", async () => {
    const wages = { createSensitiveExportTicket: jest.fn().mockResolvedValue({ downloadUrl: "/files/wage-file-1/download" }) };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new WageStatementController(wages as never, auth as never);

    await expect(controller.createSensitiveExportTicket(
      { id: "finance-user" } as never,
      "statement-1",
      { confirmationPassword: "current-password", downloadReason: "工资归档核验" } as never
    )).resolves.toEqual({ downloadUrl: "/files/wage-file-1/download" });
    expect(auth.confirmPassword).toHaveBeenCalledWith("finance-user", "current-password");
    expect(wages.createSensitiveExportTicket).toHaveBeenCalledWith("finance-user", "statement-1", "工资归档核验");
  });

  it("does not expose the optional ratio algorithm as an unconsumed HTTP operation", () => {
    expect(WageStatementController.prototype).not.toHaveProperty("ratioPreview");
  });
});
