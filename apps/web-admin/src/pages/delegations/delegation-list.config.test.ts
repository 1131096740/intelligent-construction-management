import { describe, expect, it } from "vitest";
import {
  delegationLedgerColumns,
  mapDelegationLedgerRows,
  type DelegationLedgerRow
} from "./delegation-list.config";

describe("delegation ledger page configuration", () => {
  it("shows scope, acting marker, and deadline reminder columns", () => {
    expect(delegationLedgerColumns.map((column) => column.title)).toEqual([
      "委托人",
      "受托人",
      "委托范围",
      "处理标识",
      "生效时间",
      "失效时间",
      "到期提醒",
      "状态",
      "操作"
    ]);
  });

  it("marks delegate rows as acting for another user", () => {
    const [row] = mapDelegationLedgerRows(
      [
        delegationRow({
          fromUserId: "user-a",
          fromUserName: "张总",
          toUserId: "user-b",
          toUserName: "李经理",
          endsAt: "2026-07-12T18:00:00.000Z"
        })
      ],
      "user-b",
      new Date("2026-07-08T09:00:00.000Z")
    );

    expect(row).toMatchObject({
      scopeLabel: "合同/结算/付款审批",
      actingLabel: "代 张总 处理",
      deadlineLabel: "4 天后到期",
      deadlineTone: "warning"
    });
  });

  it("marks delegator rows as handled by the delegate", () => {
    const [row] = mapDelegationLedgerRows(
      [
        delegationRow({
          fromUserId: "user-a",
          fromUserName: "张总",
          toUserId: "user-b",
          toUserName: "李经理",
          endsAt: "2026-07-09T18:00:00.000Z"
        })
      ],
      "user-a",
      new Date("2026-07-08T09:00:00.000Z")
    );

    expect(row.actingLabel).toBe("李经理 代我处理");
    expect(row.deadlineLabel).toBe("明日到期");
    expect(row.deadlineTone).toBe("warning");
  });

  it("separates revoked, not-started, expired, and malformed windows", () => {
    const rows = mapDelegationLedgerRows(
      [
        delegationRow({ id: "revoked", enabled: false }),
        delegationRow({
          id: "future",
          startsAt: "2026-07-10T00:00:00.000Z",
          endsAt: "2026-07-20T00:00:00.000Z"
        }),
        delegationRow({
          id: "expired",
          startsAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-07-07T23:00:00.000Z"
        }),
        delegationRow({ id: "bad", startsAt: "bad-date" })
      ],
      "user-b",
      new Date("2026-07-08T09:00:00.000Z")
    );

    expect(deadlineById(rows)).toEqual({
      revoked: "已撤销",
      future: "未生效",
      expired: "已过期",
      bad: "期限异常"
    });
  });
});

function delegationRow(overrides: Partial<DelegationLedgerRow> = {}): DelegationLedgerRow {
  return {
    id: "delegation-1",
    fromUserId: "user-a",
    fromUserName: "委托人",
    toUserId: "user-b",
    toUserName: "受托人",
    startsAt: "2026-07-01T00:00:00.000Z",
    endsAt: "2026-07-31T23:59:59.000Z",
    enabled: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    scopeLabel: "合同/结算/付款审批",
    actingLabel: "代 委托人 处理",
    deadlineLabel: "2026-07-31 到期",
    deadlineTone: "success",
    ...overrides
  };
}

function deadlineById(rows: DelegationLedgerRow[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.id, row.deadlineLabel]));
}
