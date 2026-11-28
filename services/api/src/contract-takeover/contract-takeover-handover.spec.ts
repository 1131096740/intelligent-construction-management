import { BadRequestException } from "@nestjs/common";
import {
  CONTRACT_TAKEOVER_HANDOVER_DUTIES,
  assertTakeoverContinuationAllowed,
  assertTakeoverHandoverReady,
  isTakeoverHandoverRegistered,
  parseTakeoverHandoverSnapshot,
  requiresTakeoverHandover,
  resolveTakeoverHandoverDuty
} from "./contract-takeover-handover";

const assignments = {
  contract: "user-contract",
  finance: "user-finance",
  supervisor: "user-supervisor"
};

function fakeTx(latest: unknown) {
  return {
    contractTakeoverConfirmationEvent: {
      findFirst: jest.fn().mockResolvedValue(latest)
    }
  } as never;
}

function handoverEvent(revision: number, payload = assignments) {
  return {
    id: `event-${revision}`,
    revision,
    action: revision === 1 ? "handover_register" : "handover_reassign",
    actorUserId: "user-director",
    createdAt: new Date("2026-11-23T00:00:00Z"),
    responseSnapshot: { schemaVersion: 1, revision, assignments: payload }
  };
}

describe("contract takeover handover", () => {
  it("lists the three department duties in business order", () => {
    expect(CONTRACT_TAKEOVER_HANDOVER_DUTIES).toEqual([
      "contract",
      "finance",
      "supervisor"
    ]);
  });

  it("treats graded legacy takeovers as already able to continue", () => {
    expect(requiresTakeoverHandover("A")).toBe(false);
    expect(requiresTakeoverHandover("B")).toBe(false);
  });

  it("requires an explicit handover for no-grade and C takeovers", () => {
    expect(requiresTakeoverHandover("NONE")).toBe(true);
    expect(requiresTakeoverHandover("")).toBe(true);
    expect(requiresTakeoverHandover("C")).toBe(true);
  });

  it("parses only a complete handover snapshot", () => {
    expect(
      parseTakeoverHandoverSnapshot({ schemaVersion: 1, revision: 2, assignments })
    ).toEqual({ schemaVersion: 1, revision: 2, assignments });
    expect(
      parseTakeoverHandoverSnapshot({ schemaVersion: 1, revision: 2, assignments: { contract: "u" } })
    ).toBeNull();
    expect(parseTakeoverHandoverSnapshot(null)).toBeNull();
  });

  it("reports registration from the latest event", async () => {
    await expect(isTakeoverHandoverRegistered(fakeTx(handoverEvent(1)), "takeover-1")).resolves.toBe(true);
    await expect(isTakeoverHandoverRegistered(fakeTx(null), "takeover-1")).resolves.toBe(false);
  });

  it("blocks no-grade continuation until the three duties are registered", async () => {
    await expect(
      assertTakeoverContinuationAllowed(fakeTx(null), { id: "takeover-1", takeoverLevel: "NONE" }, "登记后续结算")
    ).rejects.toThrow(BadRequestException);
    await expect(
      assertTakeoverContinuationAllowed(fakeTx(null), { id: "takeover-1", takeoverLevel: "NONE" }, "登记后续结算")
    ).rejects.toThrow("请先完成接管分工登记");
    await expect(
      assertTakeoverContinuationAllowed(fakeTx(handoverEvent(1)), { id: "takeover-1", takeoverLevel: "NONE" }, "登记后续结算")
    ).resolves.toBeUndefined();
  });

  it("keeps legacy A/B continuation unchanged without a handover event", async () => {
    await expect(
      assertTakeoverContinuationAllowed(fakeTx(null), { id: "takeover-1", takeoverLevel: "A" }, "登记后续结算")
    ).resolves.toBeUndefined();
  });

  it("requires the handover before submitting a no-grade takeover draft", async () => {
    await expect(
      assertTakeoverHandoverReady(fakeTx(null), { id: "takeover-1", takeoverLevel: "" }, "提交复核")
    ).rejects.toThrow("请先完成接管分工登记");
    await expect(
      assertTakeoverHandoverReady(fakeTx(handoverEvent(1)), { id: "takeover-1", takeoverLevel: "" }, "提交复核")
    ).resolves.toBeUndefined();
  });

  it("resolves the current duty of a registered user", async () => {
    await expect(
      resolveTakeoverHandoverDuty(fakeTx(handoverEvent(2)), "takeover-1", "user-finance")
    ).resolves.toBe("finance");
    await expect(
      resolveTakeoverHandoverDuty(fakeTx(handoverEvent(2)), "takeover-1", "user-other")
    ).resolves.toBeNull();
  });
});
