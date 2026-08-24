import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchNoUnauthorizedRetry: vi.fn()
}));

vi.mock("./api-fetch", () => apiMocks);

const definitionMocks = vi.hoisted(() => ({
  fetchBusinessEntryDefinition: vi.fn(),
  validateBusinessEntryDraft: vi.fn()
}));

vi.mock("./business-entry.api", () => definitionMocks);

import {
  createBusinessPartyWithIntent
} from "./business-party.api";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const payload = {
  sceneKey: "business_party" as const,
  definitionKey: "business_party" as const,
  definitionVersion: 1,
  target: { entityType: "business_party", createTarget: "signed-target" },
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  values: {
    type: "organization" as const,
    name: "云南建工",
    attachments: [] as []
  }
};

describe("business-party API contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.apiFetch.mockResolvedValue(response({ ok: true }));
    apiMocks.apiFetchNoUnauthorizedRetry.mockResolvedValue(
      response({ party: { id: "party-1" }, version: { id: "version-1" } })
    );
  });

  it("sends the final intent once without automatic unauthorized replay", async () => {
    let requestSent = 0;
    await createBusinessPartyWithIntent(payload, { onRequestSent: () => { requestSent += 1; } });

    expect(requestSent).toBe(1);
    expect(apiMocks.apiFetch).toHaveBeenCalledWith(
      "/business-parties",
      expect.objectContaining({ method: "POST" }),
      { retryUnauthorized: false }
    );
    const init = apiMocks.apiFetch.mock.calls.find(([path]) => path === "/business-parties")?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      target: payload.target,
      definitionKey: payload.definitionKey,
      definitionVersion: payload.definitionVersion,
      idempotencyKey: payload.idempotencyKey,
      values: payload.values
    });
  });

});
