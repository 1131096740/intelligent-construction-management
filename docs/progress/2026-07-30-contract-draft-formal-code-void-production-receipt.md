# 合同草稿提交前正式编号 B/void 生产处置收据

日期：2026-07-30

## 结论

用户已明确授权对唯一提交前已分配正式编号的生产草稿执行 B/void：

- 清空当前正式编号；
- `draftRevision` 从 11 递增到 12；
- 原编号永久不回收；
- 不伪造提交时间、审批实例或提交审计。

处置已成功。后置只读预检从单条 blocking 变为单条 ready；本次没有执行
transition、retention、数据库迁移、API/Web 运行时部署、真实合同提交或物理删除。

## 精确代码与发布事实

- 首个处置工具候选：
  `7e35bd753d21ab4fb2a5cbf1ea52796e6f89d30a`
- 历史操作者 ID 兼容修复候选：
  `a212f178e68debab0717ca70ed09109138e2e4c0`
- 候选分支、远端/本地 `main` 和生产 `/opt/jiangkong` 均仅 fast-forward 到修复
  候选；生产 checkout 洁净。
- 本次只更新源码 checkout，没有运行部署脚本或重启 API。
- API、Nginx、PostgreSQL 在处置前后均为 active，回环 API health 为 `ok`。

## 首次失败关闭与修复

首次 apply 使用首个候选时在事务前失败关闭。只读诊断证明：

- 报告门通过；
- 目标仍为 revision 11；
- 正式编号 SHA 未漂移；
- `firstSubmittedAt` 为空；
- 合同审批实例为 0；
- 恰好一个有效合同部主管。

根因是生产唯一合同部主管沿用合法历史 seed 用户 ID，而工具最初把
`actor-user-id` 限定为 UUID。失败后复核确认编号、revision、审批和处置审计均零
变化。

修复以失败测试复现生产 ID 形态，再将参数格式最小扩展为 1–128 位安全 ID 字符集；
事务内的活跃用户、合同部主管岗位和项目范围校验没有放宽。验证通过：

- 处置、readiness、transition 目标 Jest：3 套 20/20；
- API 全量 Jest：退出码 0；
- API typecheck、lint、build：通过；
- 处置脚本语法与 `git diff --check`：通过。

## Apply 前只读报告

- 报告生成时间：`2026-07-29T16:06:05.563Z`
- 数据库 fingerprint：
  `cea281848f875b0d683cf1998bffbd6b5b5661868fd7cbff3a27ccabee430225`
- 报告 SHA-256：
  `d9e1923077c7e8f365cf1b6457c4fb58445915c52bed3f1e798393940fd19cec`
- 精确版本：
  `722bb87e-700d-40d2-95b5-c82604cfb92c`
- 状态：`blocking`
- 唯一原因：`FORMAL_CODE_ALLOCATED_BEFORE_SUBMISSION`
- revision：11
- 正式编号 SHA-256：
  `3366a74d1d06835b3bb935cc00d57faa3a52632bfa8256f430c482a0e92332c1`
- 有效合同部主管数量：1

报告为 30 分钟内生成、未截断的 `read_only` 报告。正式编号只以 SHA 留痕，不在
收据重复写明文。

## 事务结果

受控工具返回：

```json
{
  "status": "applied",
  "decision": "void",
  "contractVersionId": "722bb87e-700d-40d2-95b5-c82604cfb92c",
  "writes": 3
}
```

三次写入为：

1. CAS 清空 `Contract.code`；
2. CAS 将 `ContractVersion.draftRevision` 从 11 递增到 12；
3. 新增一条 `contract.draft.formal_code.disposition` 审计。

事务隔离级别为 `Serializable`。锁内重新验证了版本状态、revision、提交事实、
审批实例、编号 SHA 和操作者岗位；不存在绕过工具的手工 SQL。

## 后置只读验收

- 后置报告生成时间：`2026-07-29T16:07:17.845Z`
- 后置报告 SHA-256：
  `65e1a193566d7532fa67a23a14bc87c8cf65d7096fba665d06e0f228605801fb`
- 数据库 fingerprint 与 apply 前一致。
- readiness：`ready=1`、`manualReview=0`、`blocking=0`
- 当前 revision：12
- 当前正式编号：空
- `firstSubmittedAt`：空
- 合同审批实例：0
- 正式编号处置审计：恰好 1 条
- 审计决定：`void`
- 审计中的编号 SHA 与 apply 前报告一致。
- 审计中的报告 SHA 与 apply 报告一致。
- 审计 revision：11→12
- 审计 `formalCodeWillNeverBeReused`：`true`
- `HT/20260729` 日序 `nextSequence` 保持在已分配值之后，没有回拨或回收。

## 剩余门

该记录已不再阻断草稿聚合 readiness，但这不等于 Task 6 transition 已获授权。
下一步如要执行 transition，必须另行授权维护窗口、最新报告 SHA、数据库
fingerprint、batch、操作者和精确确认串。

retention、真实业务提交、Release B、旧接口删除、小程序退役及任何物理删除继续
使用各自独立授权门。
