# #406 非生产安装与验后核对

适用于 #426 的独占非生产 PostgreSQL 16 候选。以下步骤由已有发布流程在放行 API 前执行。先记录候选提交、完整迁移账、任务 16 原材料及本目录 SQL 的 SHA-256。转款继续使用任务 16 的实付角色与账户写入权限。 [隔离验证授权](../../../../../docs/agents/development-loop.md)

## 安装顺序

1. 用数据库所有者核对目标实例标识、数据库 OID、完整迁移账和现有实付安装。另用 API 实际连接确认运行角色。使用既有独占资源身份及受控连接证明两者指向同一实例和数据库，角色彼此独立。运行角色须可登录、无角色成员关系、无超级用户、建角色、建库、复制、绕过行级策略或继承权限，并已有 `RegisteredFundAccount.writeRevision` 的更新权限。
2. 已装任务 16 的候选先运行 #406 前向迁移，由迁移在真实 `RegisteredFundPaymentAllocation` 上装容量触发器。全新隔离候选可先运行完整迁移，再按冻结顺序安装任务 16 的七份原材料和现有受限运行角色。两种顺序最后都执行下述任务 24 SQL。表或现有实付权限缺失、角色身份不符、预期原对象发生变化时停止。 [原装配顺序](../task16/README.md)
3. 使用既有的受控所有者连接，在单一 `psql` 会话中执行下面的事务。由调用方提供已经核实的 `task16_runtime_role` 变量，`\ir` 以本段放在安装入口文件时的相对路径为准。保留命令退出及脱敏首错。角色不符、同名触发器被禁用或定义不同，会使事务失败。 [任务 24 安装 SQL](registered-fund-transfer-payment-fence.sql)

```sql
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_catalog.set_config('jg.task16_runtime_role', :'task16_runtime_role', true);
\ir registered-fund-transfer-payment-fence.sql
COMMIT;
```

## 独立读回与放行

所有者在新连接读回安装结果。以 `pg_catalog.pg_class`、`pg_trigger`、`pg_proc` 和相关权限查询保存前后对照，并从 API 实际受限连接确认有效角色和权限。若存在额外权限、缺失对象或读回不一致，停止放行。

| 核对项 | 必须成立 |
| --- | --- |
| 数据库与迁移 | 既有资源身份及受控连接证明两者连接同一实例，且数据库 OID 一致。已成功迁移的名称及校验和逐条等于同一候选的迁移账。三个转款表、余额登记 `transferId`、来源批次 `receivedTransferLineId` 及其约束均存在。 |
| 实付容量约束 | 在 `public."RegisteredFundPaymentAllocation"` 上有且仅有一个同名 `RegisteredFundPaymentAllocation_transfer_capacity`。它是启用的逐行 `AFTER INSERT` 约束触发器，可延迟且初始延迟，指向本候选的 `public.jg_registered_fund_transfer_account_trigger()`。同时比对函数定义和原任务 16 容量触发器，核对运行连接为 `session_replication_role=origin`。 |
| 授权增量 | 三个转款表仅新增指定运行角色所需的读取与插入，转款表仅可更新 `status`、`revision`。两张既有表仅新增上述新列的读取与插入。核对实际有效权限及授权选项，确保未扩大原表的其他权限，未赋予运行角色删除、改写办理记录、改写已锁定金额或管理触发器的能力。独立观察角色仍只读。 |
| 业务与关闭 | 在同一候选用实际受限身份经 HTTP 核对转款两向、驳回保留预占、实退释放、同键回执、付款与转款并发守恒。独立只读事务核对资金分摊和审计。记录 HTTP 状态和有限错误类别，首错细节仅存隔离私有回执。完成后核对自建资源清理。 |

## 已有回执与剩余门槛

- `d17bb019` 完成 263 条迁移及任务 24 后置安装，首次转款在财务写入冻结分类处返回 503，未进入转款业务。 [安装后停止日志](/private/tmp/jg406-d17-real-nAzeI8/run.log)
- `200f5757` 在真实隔离 PostgreSQL 16 上通过两向转款、驳回/退回、来源链及与实付竞争。完整验收绑定该提交。 [后端实际回执](/private/tmp/jg406-200f-real-7tDXnc/run.log)
- `f706759a` 验证明确未写入的 409 及响应丢失后同键恢复。 [补充实际回执](/private/tmp/jg406-rejection-real-8DdbYS/run.log)

这些本地回执使用 `run-task398-shared-standard-local.cjs --transfer-real` 或 `--transfer-rejection-real`。#426 仍须把后置 SQL 接入实际非生产发布入口，证明目标角色的权限增量和上述完整读回，并在最终同一候选完成相关实证。 [#426 最终验收](https://github.com/1131096740/intelligent-construction-management/issues/426)
