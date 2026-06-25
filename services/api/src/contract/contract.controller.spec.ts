import "reflect-metadata";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import { REQUIRED_PROJECT_ACTION_KEY } from "../auth/decorators/require-project-role.decorator";
import {
  ContractController,
  ContractNumberRuleController
} from "./contract.controller";

describe("ContractController authorization wiring", () => {
  it("is not publicly accessible (auth guard must run)", () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ContractController)).toBeFalsy();
  });

  it.each([
    ["submitApproval", "contract.submit"],
    ["reviewApproval", "contract.approve"],
    ["transferApproval", "contract.approve"],
    ["delegateApproval", "contract.approve"],
    ["approveSeal", "contract.seal"],
    ["uploadArchiveFile", "contract.archive.upload"],
    ["confirmArchiveFile", "contract.archive.confirm"],
    ["generatePdfArchive", "contract.archive.upload"]
  ])("guards %s with the %s action", (method, action) => {
    const handler = (ContractController.prototype as unknown as Record<string, object>)[method];

    expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler as object)).toBe(action);
  });

  it.each([["withdrawApproval"], ["remindApproval"]])(
    "allows the approval applicant to %s without project approval action metadata",
    (method) => {
      const handler = (ContractController.prototype as unknown as Record<string, object>)[method];

      expect(Reflect.getMetadata(REQUIRED_PROJECT_ACTION_KEY, handler as object)).toBeUndefined();
    }
  );

  it("forwards the required numbering body on approval submission", async () => {
    const contracts = { submitApproval: jest.fn() };
    const controller = new ContractController(
      contracts as never,
      {} as never,
      {} as never
    );

    controller.submitApproval(
      "version-1",
      { id: "owner-1" } as never,
      { numberRuleId: "rule-1" }
    );

    expect(contracts.submitApproval).toHaveBeenCalledWith(
      "version-1",
      "owner-1",
      { numberRuleId: "rule-1" }
    );
  });

  it("forwards number-rule maintenance bodies to runtime-validating service methods", () => {
    const numbering = {
      create: jest.fn(),
      update: jest.fn(),
      stop: jest.fn()
    };
    const controller = new ContractNumberRuleController(numbering as never);
    const user = { id: "director-1" } as never;

    controller.create(user, { name: "规则" });
    controller.update("rule-1", user, { pattern: "HT-{sequence}" });
    controller.stop("rule-1", user);

    expect(numbering.create).toHaveBeenCalledWith("director-1", { name: "规则" });
    expect(numbering.update).toHaveBeenCalledWith(
      "rule-1",
      "director-1",
      { pattern: "HT-{sequence}" }
    );
    expect(numbering.stop).toHaveBeenCalledWith("rule-1", "director-1");
  });
});
