import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import {
  beginTakeoverSideSave,
  completeTakeoverSideSave,
  createTakeoverSideSaveState,
  failTakeoverSideSave,
  replaceTakeoverSideModel
} from "./contract-takeover-side-save.state";

describe("historical takeover side save state", () => {
  it("keeps contract and finance models, revisions and attempts independent", () => {
    const contract = createTakeoverSideSaveState({ settled: "100" }, 2);
    const finance = createTakeoverSideSaveState({ paid: "80" }, 4);

    replaceTakeoverSideModel(contract, { settled: "101" });
    const attempt = beginTakeoverSideSave(
      contract,
      () => "11111111-1111-4111-8111-111111111111"
    );

    expect(attempt).toMatchObject({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      expectedRevision: 2,
      model: { settled: "101" }
    });
    expect(finance).toMatchObject({
      revision: 4,
      model: { paid: "80" },
      dirty: false,
      saving: false
    });
  });

  it("preserves input typed during an in-flight save and saves it in the next attempt", () => {
    const state = createTakeoverSideSaveState({ settled: "100" }, 2);
    replaceTakeoverSideModel(state, { settled: "101" });
    const first = beginTakeoverSideSave(
      state,
      () => "11111111-1111-4111-8111-111111111111"
    );

    replaceTakeoverSideModel(state, { settled: "102" });
    completeTakeoverSideSave(state, first, 3);

    expect(state).toMatchObject({
      revision: 3,
      model: { settled: "102" },
      dirty: true,
      saving: false
    });
    const second = beginTakeoverSideSave(
      state,
      () => "22222222-2222-4222-8222-222222222222"
    );
    expect(second).toMatchObject({
      expectedRevision: 3,
      model: { settled: "102" },
      idempotencyKey: "22222222-2222-4222-8222-222222222222"
    });
  });

  it("reuses the frozen idempotency key after a retryable network failure", () => {
    const state = createTakeoverSideSaveState({ paid: "80" }, 4);
    replaceTakeoverSideModel(state, { paid: "81" });
    const first = beginTakeoverSideSave(
      state,
      () => "33333333-3333-4333-8333-333333333333"
    );

    failTakeoverSideSave(state, first, true);
    const retry = beginTakeoverSideSave(
      state,
      () => "44444444-4444-4444-8444-444444444444"
    );

    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
    expect(retry.model).toEqual(first.model);
  });

  it("accepts Vue reactive form models without leaking proxies into the save attempt", () => {
    const state = createTakeoverSideSaveState({ facts: { name: "旧名称" } }, 1);
    const reactiveModel = reactive({ facts: { name: "新名称" } });

    expect(() => replaceTakeoverSideModel(state, reactiveModel)).not.toThrow();
    const attempt = beginTakeoverSideSave(
      state,
      () => "55555555-5555-4555-8555-555555555555"
    );

    expect(attempt.model).toEqual({ facts: { name: "新名称" } });
    expect(attempt.model).not.toBe(reactiveModel);
  });
});
