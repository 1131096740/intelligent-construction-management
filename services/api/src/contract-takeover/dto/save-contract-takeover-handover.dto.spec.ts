import { createApiValidationPipe } from "../../validation/api-validation";
import { SaveContractTakeoverHandoverDto } from "./save-contract-takeover-handover.dto";

const bodyMetadata = {
  type: "body" as const,
  metatype: SaveContractTakeoverHandoverDto,
  data: undefined
};
const assignments = {
  contractUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  financeUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  supervisorUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
};

describe("SaveContractTakeoverHandoverDto", () => {
  it("accepts a first assignment with no replacement reason", async () => {
    await expect(createApiValidationPipe().transform(assignments, bodyMetadata))
      .resolves.toMatchObject(assignments);
  });

  it.each([
    [null, "更换接管责任人原因必须是文字"],
    [" ", "更换接管责任人原因不能为空白"],
    ["长".repeat(501), "更换接管责任人原因不能超过 500 字"]
  ])("rejects an invalid supplied replacement reason", async (reason, message) => {
    await expect(createApiValidationPipe().transform({ ...assignments, reason }, bodyMetadata))
      .rejects.toMatchObject({ response: { errors: expect.arrayContaining([message]) } });
  });
});
