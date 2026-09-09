# POL-275 清算核对关系设计版本与授权补充

> 状态：非生产候选实现依据。本文只补充 Issue #275 已批准设计的版本、差异与授权对应关系，不扩大产品范围，也不构成生产迁移、部署、权限或数据操作授权。

## 1. 固定依据

| 版本 | 设计身份 | 已批准范围 | 状态 |
| --- | --- | --- | --- |
| V1（2026-09-09） | 原审批稿 SHA-256 `f98d24aced27781080cf2e82f09cffcbb26b9b2d67d7f305b8cad431c2942d57`；`DESIGN_APPROVAL` 回执副本 SHA-256 `32c30833f121dbfba7c75efaa9df3d0ced562536fe3db6321416f7d0784c5bd6` | 七张 append-only 关系表、三个新事件 kind、P1-P6、V1 冻结意图、DecisionSeal、受控 writer、专用 NOLOGIN owner/runtime 隔离、公共业务 seam 与 disposable PostgreSQL 16 验证 | 明确批准 |
| V1.1（2026-09-09） | 修订设计稿 `/private/tmp/pol275-schema-migration-design-20260908.md`，SHA-256 `da3263fb8e3b7c54d58747c98d7dc77b1cdbed44c91b3a7e9eff85bc368007c6` | 在 V1 内收敛 legacy/V1 真实退回双向互斥、prior-economic 固定双 impact 冻结形状、按 exact allocation 独立累计容量；后续明确统一来源资格为 `Event.workflowStatus=confirmed` 且存在 exact `ClearingConfirmation` | 分项明确批准 |
| V1.2（2026-09-10，本补充） | 当前五步 #275 修复包 | 精确 runtime ACL、公共来源引用、四层来源资格复验、legacy/V1 共用净占用、coverage 转 allocation 精确释放、真实 PG16 回归、checksum/manifest/账本及固定 SHA 证据链 | 明确批准，待候选终验 |

原审批稿的业务形状仍是主设计；V1.1 与 V1.2 只覆盖下表列出的增量。外部临时路径用于标识当时经审批/复审的不可变输入，不作为仓库长期来源；本文及 `PROGRESS.md` 是仓库内的版本化对应记录。

## 2. 差异与授权逐项核对

| 差异 | 相对 V1 的性质 | 对应明确授权 | 结论 |
| --- | --- | --- | --- |
| legacy 无 V1 退回与 V1 exact-allocation 退回在同一来源上双向互斥 | 数据完整性补强 | 已授权“三项代码/设计修复”之一 | 已覆盖 |
| prior-economic 冻结 exact `sourceImpactIds` 双元素集合 | 冻结证据形状补强 | 已授权“三项代码/设计修复”之一 | 已覆盖 |
| prepare/revise 以 `sourceClearingAllocationId` 独立累计容量 | 容量算法纠错 | 已授权“三项代码/设计修复”之一 | 已覆盖 |
| legacy 与 V1 均以“Event confirmed + exact Confirmation”判定来源资格，不要求 EventVersion 自身为 `confirmed` | 统一既有资格语义 | 用户后续明确授权统一来源资格语义 | 已覆盖 |
| runtime 只获得 `pol275_append_reconciliation_set(text,text)` 与 `pol275_active_coverage_occupancy(text)` 的 exact EXECUTE；测试不再获得 schema 全函数执行权 | 落实 V1 的最小权限设计 | 本次五步修复包第 2 步明确授权 | 已覆盖 |
| `GET /affiliate-clearing-authorities/allocation-options/:caseId` 同时签发版本级、coverage 级与 exact-allocation 级短效引用 | 补齐已批准公共业务 seam | 本次五步修复包第 2 步明确授权 | 已覆盖 |
| 来源引用签名绑定 actor、case、purpose、selected key、authority coordinate 与当前 case revision | 输入真实性补强 | 本次五步修复包第 2 步明确授权 | 已覆盖 |
| options、create/revise、confirm 事务锁内复验和数据库 guard/deferred closure 使用同一来源资格 | V1 已要求的冻结后漂移防御补齐 | 本次五步修复包第 3 步明确授权 | 已覆盖 |
| 暂扣可用量统一为 `原金额 - 净经济分配 - 有效覆盖占用`；同一决策 coverage 转 allocation 只释放 exact 对应金额 | V1 容量恒等式落地修复 | 本次五步修复包第 3 步明确授权 | 已覆盖 |
| 受限角色、公共引用、来源漂移、技术反向释放、legacy/V1 顺序及并发回归 | 验收证据补齐 | 本次五步修复包第 4 步明确授权 | 已覆盖 |

逐项核对结果：当前 V1.2 修复包没有发现超出既有授权的产品、Schema、迁移或业务语义差异；因此无需新增 owner 决定。若实现过程中出现新的表/字段、迁移策略、来源类别、角色能力、数据所有权或生产动作，必须重新停止并提交设计冲突。

## 3. V1.2 冻结契约

### 3.1 公共来源引用

同一公共 options API 返回三类短效引用：

1. `purpose=allocation`：选择同案、Event 已确认且具有 exact Confirmation 的 `withheld`、`final_confirmed` 或 `supplemental` EventVersion；
2. `purpose=coverage`：选择当前仍有开放金额的 exact `ClearingReconciliationCoverage`；
3. `purpose=prior_economic_allocation`：选择同案 final/supplemental 事件下、具有完整双 impact 证据且仍有可退回效果的 exact 原 `ClearingAllocation`。

短效引用不持久化，不接受客户端伪造 source/coverage/allocation ID。V1 create/revise 必须用准备人身份取得引用；legacy confirm 的版本级引用必须用实际确认人身份取得。提交、attest 与 confirm 继续绑定已冻结的 exact EventVersion/fingerprint。

### 3.2 来源资格与容量

所有入口执行同一资格：关联 `ClearingEvent.workflowStatus = confirmed` 且存在该 EventVersion 的 exact `ClearingConfirmation`。EventVersion 自身可能仍为 `submitted`，不作为来源资格的替代条件。

对 withheld EventVersion：

```text
netEconomicAllocation
= sum(original ClearingAllocation) - sum(exact technical reversals)

usable
= source.amountCents - netEconomicAllocation - activeCoverageOccupancy
```

coverage 解决转成 allocation 时，只按同一冻结 intent 中一一对应的 coverage、resolution line 与 planned allocation 金额释放占用；普通余量 allocation 不获得该释放。技术反向同时恢复被反向的经济容量与相应 coverage 开放量，最终仍满足 `netEconomicAllocation + activeCoverageOccupancy <= source.amountCents`。

prior-economic exact allocation 的可退回效果按原 allocation 金额扣除其 exact 技术反向和已确认 V1 真实退回净占用；legacy 与 V1 退回不得在同一 source EventVersion 上混用。

### 3.3 确认与数据库兜底

confirm 在 Serializable 事务内按稳定 advisory key 锁定案件、来源 EventVersion；exact prior-economic 还锁定原 allocation。锁内重新校验 Event confirmed、exact Confirmation、kind、case、fingerprint、impact 集合和净容量。漂移只能要求 revise，不得替换来源。

数据库 guard 与 deferred closure 独立复验相同条件；runtime 不能直接写七张关系表，也不能执行本迁移未列入 exact grant 的 POL-275 受控函数。测试连接不得通过 `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` 掩盖真实 runtime 权限。

## 4. 证据与交付边界

候选变更期间允许定向单元/fixture/PG16 回归迭代。同步本文、终端迁移 checksum、canonical dynamic manifest 和 `PROGRESS.md` 后才冻结新 candidate SHA。该 SHA 只各执行一次完整专用 PostgreSQL 16 和 Node.js `v20.20.2` 的 `release:local`；两者通过后才进行原 Standards/Spec 双审。

历史 SHA 的通过收据只证明历史状态，不证明新候选。任何代码、迁移、manifest 或账本变更都会使此前固定 SHA 的正式收据失效。最终 GitHub PR、fixed-head CI、merge-head CI、Issue #275 关闭和 #93 回执必须绑定最终通过的 SHA/merge SHA；#93 保持 OPEN，#108 在 #275 交付证据完成前继续暂停。

本补充不授权部署、生产扫描、生产 migration/apply、生产数据库/COS/角色/ACL 操作、真实业务数据读写、回填、激活、回滚或清理。
