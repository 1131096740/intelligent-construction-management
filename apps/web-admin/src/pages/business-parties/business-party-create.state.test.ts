import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_PARTY_CREATE_DEFINITION_KEY,
  BUSINESS_PARTY_CREATE_SCENE,
  createBusinessPartyRecoveryEnvelope,
  createSingleFlight,
  fingerprintBusinessPartyValues,
  readBusinessPartyRecoveryEnvelope,
  normalizeBusinessPartyCreateValues,
  classifyBusinessPartyCreateFailure,
  saveBusinessPartyRecoveryEnvelope
  ,validateBusinessPartyCreateValues
} from "./business-party-create.state";

describe("business-party create state", () => {
  it("normalizes only server-owned organization values before fingerprinting", async () => {
    const values = normalizeBusinessPartyCreateValues({
      name: "  云南  建设有限公司 ",
      unifiedSocialCreditCode: " 91350211m000100y46 "
    });

    expect(values).toEqual({
      name: "云南 建设有限公司",
      unifiedSocialCreditCode: "91350211M000100Y46"
    });
    await expect(fingerprintBusinessPartyValues(values)).resolves.toMatch(/^[0-9a-f]{64}$/u);
  });

  it("round-trips a versioned pending recovery envelope without storing a target token", () => {
    const storage = new Map<string, string>();
    const envelope = createBusinessPartyRecoveryEnvelope({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      fingerprint: "a".repeat(64),
      values: { name: "待恢复单位", unifiedSocialCreditCode: "" }
    });

    saveBusinessPartyRecoveryEnvelope(storage, envelope);
    const recovered = readBusinessPartyRecoveryEnvelope(storage);
    expect(recovered).toMatchObject({
      sceneKey: BUSINESS_PARTY_CREATE_SCENE,
      definitionKey: BUSINESS_PARTY_CREATE_DEFINITION_KEY,
      idempotencyKey: envelope.idempotencyKey,
      values: envelope.values
    });
    expect(JSON.stringify(recovered)).not.toContain("createTarget");
  });

  it("coalesces concurrent confirmation calls into one request", async () => {
    const run = createSingleFlight();
    const factory = vi.fn(async () => "created");
    const [first, second] = await Promise.all([run(factory), run(factory)]);

    expect(first).toBe("created");
    expect(second).toBe("created");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("keeps the fixed failure matrix fail-closed", () => {
    expect(classifyBusinessPartyCreateFailure("capability", new Error("当前账号无权使用该业务场景")).kind)
      .toBe("capability");
    expect(classifyBusinessPartyCreateFailure("submission", new Error("令牌无效、已过期")).kind)
      .toBe("submission_expired");
    expect(classifyBusinessPartyCreateFailure("create", new Error("名称或统一社会信用代码已存在")).kind)
      .toBe("conflict");
  });

  it("rejects invalid values before any write request", () => {
    expect(validateBusinessPartyCreateValues({ name: "", unifiedSocialCreditCode: "" }))
      .toEqual(["请填写合作单位名称"]);
    expect(validateBusinessPartyCreateValues({ name: "有效单位", unifiedSocialCreditCode: "913502110000000000" }))
      .toEqual(["统一社会信用代码格式或校验位不正确"]);
  });
});
