import { describe, expect, it, vi } from "vitest";
import {
  BUSINESS_PARTY_CREATE_DEFINITION_KEY,
  BUSINESS_PARTY_CREATE_SCENE,
  assertBusinessPartyEntryValidation,
  assertBusinessPartyFingerprintMatches,
  assertBusinessPartyFreshDefinition,
  businessPartyIdFromConflictError,
  classifyBusinessPartyCreateFailure,
  createBusinessPartyRecoveryEnvelope,
  createSingleFlight,
  fingerprintBusinessPartyValues,
  normalizeBusinessPartyCreateValues,
  readBusinessPartyRecoveryEnvelope,
  resolveBusinessPartyIntentKey,
  resolveBusinessPartyRecoveryKey,
  saveBusinessPartyRecoveryEnvelope,
  submissionTargetOf,
  validateBusinessPartyCreateValues
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

  it("propagates storage and frozen-target failures to the caller", () => {
    const storageFailure = new Error("storage unavailable");
    const storage = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw storageFailure;
      })
    };
    const envelope = createBusinessPartyRecoveryEnvelope({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      fingerprint: "a".repeat(64),
      values: { name: "待恢复单位", unifiedSocialCreditCode: "" }
    });
    expect(() => saveBusinessPartyRecoveryEnvelope(storage, envelope))
      .toThrow(storageFailure);

    expect(() => submissionTargetOf({}))
      .toThrow("服务器未返回独立合作单位提交授权");
  });

  it("coalesces concurrent confirmation calls into one request", async () => {
    const run = createSingleFlight();
    const factory = vi.fn(async () => "created");
    const firstPromise = run(factory);
    const secondPromise = run(factory);
    expect(secondPromise).toBe(firstPromise);
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first).toBe("created");
    expect(second).toBe("created");
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("keeps the original key for the same definition and rotates after a definition change", () => {
    const issueIdempotencyKey = vi.fn(() => "22222222-2222-4222-8222-222222222222");
    const existingIdempotencyKey = "11111111-1111-4111-8111-111111111111";

    expect(resolveBusinessPartyRecoveryKey({
      existingIdempotencyKey,
      previousDefinitionVersion: 1,
      currentDefinitionVersion: 1,
      issueIdempotencyKey
    })).toEqual({ idempotencyKey: existingIdempotencyKey, rotated: false });
    expect(resolveBusinessPartyRecoveryKey({
      existingIdempotencyKey,
      previousDefinitionVersion: 1,
      currentDefinitionVersion: 2,
      issueIdempotencyKey
    })).toEqual({
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      rotated: true
    });
    expect(issueIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("rotates the idempotency key whenever normalized values change", () => {
    const issueIdempotencyKey = vi.fn(() => "22222222-2222-4222-8222-222222222222");
    const existingIdempotencyKey = "11111111-1111-4111-8111-111111111111";

    expect(resolveBusinessPartyIntentKey({
      existingIdempotencyKey,
      previousFingerprint: "same",
      currentFingerprint: "same",
      issueIdempotencyKey
    })).toEqual({ idempotencyKey: existingIdempotencyKey, rotated: false });
    expect(resolveBusinessPartyIntentKey({
      existingIdempotencyKey,
      previousFingerprint: "before",
      currentFingerprint: "after",
      issueIdempotencyKey
    })).toEqual({
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      rotated: true
    });
    expect(issueIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("projects only a bounded duplicate party id", () => {
    expect(businessPartyIdFromConflictError(Object.assign(new Error("重复"), {
      partyId: "party-existing",
      normalizedSnapshot: { name: "不得泄露" }
    }))).toBe("party-existing");
    expect(businessPartyIdFromConflictError(new Error("重复"))).toBeNull();
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

  it("fails closed for stale definitions, invalid receipts, and changed fingerprints", () => {
    expect(() => assertBusinessPartyFreshDefinition("business_party", "business_party", 1))
      .not.toThrow();
    expect(() => assertBusinessPartyFreshDefinition("business_party", "other", 1))
      .toThrow("合作单位字段定义已变化，请刷新页面后重试");
    expect(() => assertBusinessPartyEntryValidation({ valid: true, errors: [] }))
      .not.toThrow();
    expect(() => assertBusinessPartyEntryValidation({
      valid: false,
      errors: [{ message: "字段无效" }]
    })).toThrow("字段无效");
    expect(() => assertBusinessPartyFingerprintMatches("same", "same")).not.toThrow();
    expect(() => assertBusinessPartyFingerprintMatches("changed", "expected"))
      .toThrow("服务器规范化资料已变化，请重新确认后重试");
  });
});
