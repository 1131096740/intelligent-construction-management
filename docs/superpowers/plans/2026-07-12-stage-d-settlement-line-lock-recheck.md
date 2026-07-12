# Stage D Settlement Line Lock Recheck Plan

**Goal:** 关闭并发创建结算时合同清单累计金额可能同时通过锁前检查的窗口，确保同一项目内不会因竞态产生超清单金额结算。

## Backend

- 保留现有锁前 `assertContractBillRowSettlementLimits` 快速校验。
- `reserveSettlementQuota` 取得并确认 Project `FOR UPDATE` 行锁后，在任何 Settlement、SettlementLine、额度占用、审批或审计写入前，再执行同一累计金额校验。
- 二次校验继续复用 `SETTLEMENT_LINE_OCCUPANCY_STATUSES`，看到等待行锁期间其他事务已提交的 active 结算明细。
- 不改 DTO、API、Web 或数据库结构；`settlementLines` 缺省/空数组和纯 `manual_adjustment` 行保持原行为。

## Deferred Rule Boundary

- 本切片不实现 quantity × unitPrice canonical 重算。税前/税后单价选择、Decimal 到分的映射、舍入尾差、空数量以及 provisional/reference/non-priced 累计规则尚无唯一仓库事实，必须先完成业务规则确认。

## Verification

- TDD 模拟锁前无占用、Project 加锁后看到并发 active 行并超限；断言第二次查询发生在 `FOR UPDATE` 后。
- 超限、Project 锁未取得均 fail closed，且 Settlement、Line、额度、审批、审计零写。
- 回归缺省/空明细及手工调整；运行 targeted Jest、API typecheck/lint/build 与独立复审。
