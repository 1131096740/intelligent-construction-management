# Role Addition Safety Plan

**Goal:** 在不放宽现有岗位撤销契约的前提下，新增“单条岗位新增”的影响预览与安全写入，使全局 `super_admin` 能为启用人员配置规范全局/项目岗位，并对冻结审批节点、自审与委托语义失败关闭。

**Boundary:** 本切片只支持一次新增一条规范岗位事实；不支持批量、替换、upsert、项目级 `super_admin`、legacy `UserPosition` 迁移、真实数据初始化或生产写入。岗位撤销 API/响应/hash 保持兼容。

## Backend contract

- 新增独立 `PreviewRoleAdditionDto` / `ApplyRoleAdditionDto` 与端点：
  - `POST /organization/role-additions/preview`
  - `POST /organization/role-additions/apply`
- controller 继续继承全局 `super_admin` 守卫，actor 只取登录态；请求不得接受 assignmentId、actor、审计字段或数组。
- preview 不接收密码；apply 只接收同一 change、严格 `sha256:<64 lowercase hex>` snapshot hash 和当前密码原值。

## Impact evaluation

- 在同一轮只读事实读取中合成待新增的规范事实，再复用真实审批写侧的优先级：冻结 `roleKeys` 顺序内第一个直接岗位 > 冻结 assignment > 有效委托；preview 是并发提示而不是数据库原子快照，最终安全性由 apply 的 Serializable 事务内重算与 hash 比对保证。
- 每个在途实例必须从 `currentNodeIndex` 扫描至冻结流程末尾；相关节点既包括冻结 `roleKeys` 含新增岗位的节点，也包括新增 action 岗位会首次解锁目标既有 frozen assignment 的节点，不能只看当前节点或 `pendingRoleKeys`。每个被评估节点完整进入稳定 hash，节点按实例 ID 与节点序号排序，不依赖数据库返回顺序。
- preview 对目标人员明确返回 before/after 的解析岗位、来源通道、自审状态与可审批状态；新增导致目标从可审批变为不可审批时，即使节点仍有其他审批人也必须独立阻断。
- 申请人新增普通前置岗位后，不得借原有领导岗位继续自审；新增董事长/总经理岗位只有在其确为当前解析岗位时才标记需要自审二次确认。
- 冻结岗位必须同时属于对应业务动作的 `ACTION_REQUIRED_ROLES`；技术岗 `super_admin` 不进入任何业务审批 direct fact，脏冻结节点按非法审批数据失败关闭。
- contract/settlement/payment 的 frozen assignment 只有在接收人能以本人规范岗位或有效常驻委托通过真实 HTTP action guard 时才计为可审批；assignment 本身不创造入口资格。项目支出继续完全忽略 assignment/delegation，包括其脏字段；多岗位 `all` 节点继续按现有不安全语义失败关闭。
- global add 扫描所有项目，project add 只扫描目标项目；冻结数组顺序保留，数据库无序事实稳定排序后进入 hash。

## Fail-closed conditions

- 人员、固定岗位或项目不存在；目标人员停用；项目岗位所属项目停用。
- 项目范围新增 `super_admin`。
- 规范目标事实已存在或出现重复；项目坐标存在 legacy `UserPosition` shadow。
- 全局重复、任意 legacy 项目 `UserPosition`、双源重叠、无效岗位、项目级 `super_admin` 或孤儿事实导致规范岗位写入 readiness 未通过。
- 相关在途审批业务映射、冻结节点或执行语义无法安全解析。

## Apply transaction

- 事务外按原值确认当前密码；Serializable 事务内复核 actor 仍为启用的规范全局 `super_admin`。
- 使用同一 transaction client 重算完整性、影响与 hash；hash 漂移、阻断或 create target/source 不一致均 409，零岗位写入、零 token、零审计。
- global 仅创建 `UserPosition(userId, positionId, projectId=null)`；project 仅创建 `ProjectMember(userId, projectId, positionKey)`；不接受客户端记录 ID，不使用 `createMany`/upsert。
- 成功后同事务撤销目标人员未撤销 refresh token，并记录白名单 `permission.role.add` 审计；审计不得包含密码、整份 preview 或 token。
- P2002/P2034 映射固定中文 409；数据库唯一约束作为竞态兜底。全局新增依赖本地部分唯一索引 migration，未发布前不得进行生产新增。

## TDD and verification

- DTO/controller：运行时 DTO、未知字段、add-only、scope/projectId、hash/password 和 actor session-only。
- impact：global/project 合成事实、重复/shadow/readiness、停用人员/项目、project super_admin、当前及未来节点 first-role 自审反转、before/after 能力下降、direct 覆盖 assignment/delegation、HTTP action guard 资格、项目支出忽略 indirect 脏字段、范围过滤、multi-all、非法业务映射与稳定 hash。
- apply：密码失败零事务、actor TOCTOU、同 tx 重算、精确 create source/data、stale/blocking/source mismatch 零写、token 撤销、白名单审计、P2002/P2034、审计异常不吞。
- 运行组织模块 targeted Jest、API business-errors/typecheck/lint/build、Prisma validate、`git diff --check`；独立安全与质量复审后再更新 `PROGRESS.md`。
- Web 单条新增交互作为后续独立切片；本后端切片不顺带修改撤销抽屉。
- 发布验收不能用 `Prisma validate` 代替原生部分索引验证；部署迁移后必须只读查询 `pg_indexes`，确认 `UserPosition_global_user_position_key` 存在，才允许人工使用全局岗位新增入口。
