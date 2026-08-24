import { describe, expect, it, vi } from "vitest";
import {
  createBusinessPartySubmissionController,
  normalizeBusinessPartyValues,
  readBusinessPartyPendingRecovery,
  writeBusinessPartyPendingRecovery,
  type BusinessPartyCreateFlowDependencies
} from "./business-party-create-flow";

const definition = {
  key: "business_party",
  entityType: "business_party",
  name: "合作单位",
  description: "",
  version: 7,
  fields: [],
  rules: []
} as const;

function dependencies(
  overrides: Partial<BusinessPartyCreateFlowDependencies> = {}
): BusinessPartyCreateFlowDependencies {
  return {
    issueCreateTarget: vi.fn(async () => ({
      createTarget: "signed-target",
      expiresAt: "2026-08-24T00:05:00.000Z"
    })),
    fetchDefinition: vi.fn(async () => definition),
    validate: vi.fn(async (payload) => ({
      valid: true,
      sceneKey: payload.sceneKey,
      definitionVersion: definition.version,
      values: payload.values,
      errors: []
    })),
    create: vi.fn(async () => ({ party: { id: "party-1" }, version: { id: "version-1" } })),
    ...overrides
  };
}

describe("business-party create flow", () => {
  it("normalizes the exact server-owned organization snapshot", () => {
    expect(normalizeBusinessPartyValues({
      name: "  云南\u00a0建工  ",
      unifiedSocialCreditCode: " 91350211m000100y46 "
    })).toEqual({
      type: "organization",
      name: "云南 建工",
      unifiedSocialCreditCode: "91350211M000100Y46",
      attachments: []
    });
  });

  it("uses a read-only probe without crossing into the create call", async () => {
    const deps = dependencies();
    const controller = createBusinessPartySubmissionController(deps);

    const result = await controller.probe();

    expect(result.definition.version).toBe(7);
    expect(deps.issueCreateTarget).toHaveBeenCalledTimes(1);
    expect(deps.fetchDefinition).toHaveBeenCalledTimes(1);
    expect(deps.validate).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("does not create when server validation is invalid", async () => {
    const deps = dependencies({
      validate: vi.fn(async (payload) => ({
        valid: false,
        sceneKey: payload.sceneKey,
        definitionVersion: definition.version,
        values: payload.values,
        errors: [{ code: "required_field" as const, fieldKey: "name", message: "请填写单位名称" }]
      }))
    });
    const controller = createBusinessPartySubmissionController(deps);

    const prepared = await controller.prepare({ name: " " });

    expect(prepared.state).toBe("invalid");
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("reuses one promise and one idempotency key for a double submit", async () => {
    let resolveCreate!: (value: unknown) => void;
    const deps = dependencies({
      create: vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }))
    });
    const controller = createBusinessPartySubmissionController(deps);
    const prepared = await controller.prepare({ name: "云南建工" });

    if (prepared.state !== "confirm") throw new Error("expected confirmation state");
    const first = controller.submit(prepared);
    const second = controller.submit(prepared);

    expect(second).toBe(first);
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect((vi.mocked(deps.create).mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey)
      .toBe(prepared.payload.idempotencyKey);
    resolveCreate({ party: { id: "party-1" } });
    await expect(first).resolves.toEqual({ party: { id: "party-1" } });
  });

  it("stores only the pending recovery envelope and never a target or token", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    };
    writeBusinessPartyPendingRecovery(adapter, {
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      definitionKey: "business_party",
      definitionVersion: 7,
      values: {
        type: "organization",
        name: "云南建工",
        attachments: []
      }
    });

    const raw = storage.get("jiangkong-business-party-create-recovery");
    expect(raw).not.toContain("signed-target");
    expect(raw).not.toContain("accessToken");
    expect(readBusinessPartyPendingRecovery(adapter)).toEqual({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      definitionKey: "business_party",
      definitionVersion: 7,
      values: {
        type: "organization",
        name: "云南建工",
        attachments: []
      }
    });
  });
});
