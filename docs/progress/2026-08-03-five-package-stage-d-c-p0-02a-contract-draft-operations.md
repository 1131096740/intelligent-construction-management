# 五包阶段 D：C-P0-02a 合同草稿租约、保存与预览动作清零回执

## 1. 结论

`C-P0-02` 已按共享根因拆成 6 个依赖有序子组。本轮完成第 1 组：合同草稿编辑租约、自动/手动保存、预览生成和租约接管。

阶段 C 登记的合同域基线为 85 个未覆盖生产写 consumer pair、11 个未闭合动作绑定、87 条去重 P0 证据。本轮精确关闭 6 个 pair 和 6 个未闭合绑定；因自动保存与手动保存共享同一个生产 consumer，实际新增 7 个可验证动作登记。`C-P0-02` 当前剩余 79 个 pair、5 个未闭合绑定、81 条去重证据，尚未完成，下一步只能进入第 2 组。

整站矩阵仍为 `blocked`，Task 11、阶段 D、实施包 5 和五包整体均不得标记完成。本轮没有连接生产、执行数据库或迁移、修改业务数据、合并 PR 或部署。

## 2. C-P0-02 唯一子组顺序

| 顺序 | 子组 | 基线 pair | 基线 unresolved | 当前状态 |
| --- | --- | ---: | ---: | --- |
| 1 | 草稿租约、聚合保存、预览与租约接管 | 6 | 6 | **已本地清零** |
| 2 | 草稿创建、提交、负责人转移与工作台治理 | 7 | 2 | 下一步 |
| 3 | 文件、清单、授权、洽商与正式文档 | 21 | 0 | 待执行 |
| 4 | 审批、用印、归档与合同变更生命周期 | 16 | 0 | 待执行 |
| 5 | 历史合同接管主流程 | 28 | 3 | 待执行 |
| 6 | 接管税务事实与双部门确认 | 7 | 0 | 待执行 |
| **合计** |  | **85** | **11** | **剩余 79 / 5** |

不得跨组并行修改共享合同状态。每组继续按“后端动作与不变量 → 服务端 capability → Web 失败关闭 → 清单因果证明 → 聚焦及扩展回归”的顺序收口。

## 3. 本轮实现

### 3.1 服务端能力与路由权限

- 合同草稿工作台读模型新增 `draftOperationAvailableActions`，由服务端按当前经办人与合同主管接管条件发布精确动作字符串。
- 草稿预览、租约取得、续期、接管和释放路由补齐与保存路由一致的 `contract.create` 项目权限 metadata。
- 经办人只获得取得/续期/释放租约、保存和预览动作；只有满足现有接管条件的合同主管获得租约接管动作。

### 3.2 Web 写前二次预检

- 页面首次加载仍用工作台响应控制按钮、自动取得租约和本地失败关闭。
- 每次实际租约、保存、接管或预览写请求前，通过独立 Web 只读 wrapper 重新读取同一 `/contract-drafts/:id/workbench`；没有新增后端路由。
- 预检响应必须匹配请求版本，并包含当前写操作的精确动作字符串；缺失、漂移或请求失败均在写请求前终止。
- 自动保存与手动保存分别建立顶层可追踪 handler，但复用同一保存 API 和同一服务端动作；页面按钮与接管对话框继续受缓存 capability 控制，执行时再以最新服务端 capability 复核。

### 3.3 清单门禁补强

页面动作检查器此前只能证明 Vue 模板条件，无法接受安全的后台写前预检。本轮以 RED 正反例补齐后台模型，只接受以下结构：

1. 顶层后台 handler 从透明 GET wrapper 取得服务端结果；
2. 精确动作判断来自该局部服务端结果；
3. capability 不成立时必须失败关闭并中止；
4. capability guard 之前只允许已识别的只读服务端调用；
5. mutation wrapper 必须位于 guard 之后并具有可验证调用链。

测试同时证明“先写后检查”的反例继续失败，局部同名变量按真实 scope binding 解析，不会冒充顶层或其他函数的服务端来源。

## 4. 目标动作证据

以下 7 个动作均为 `serverDerived=true`、`dominatesTrigger=true`、`causalVerified=true`，且其生产 consumer 已被接受覆盖：

- `contract-draft.aggregate-autosave`
- `contract-draft.manual-save`
- `contract-draft.lease-acquire`
- `contract-draft.lease-heartbeat`
- `contract-draft.lease-release`
- `contract-draft.lease-takeover`
- `contract-draft.preview-queue`

## 5. 矩阵对账

| 项目 | C-P0-01 后 | C-P0-02a 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 401 | 401 | 0 |
| Web wrappers / bindings | 390 / 410 | 391 / 411 | +1 只读预检 wrapper / +1 GET binding |
| 注册动作 | 63 | 64 | +1 租约接管动作 |
| accepted action bindings | 49 | 56 | +7 |
| unresolved action bindings | 20 | 14 | -6 |
| covered production mutation pairs | 34 | 40 | +6 |
| uncovered production mutation pairs | 243 | 237 | -6 |
| unclassified routes | 0 | 0 | 0 |
| raw blockers | 306 | 294 | -12 |

`C-P0-02` 风险表中的 11 个 unresolved 与部分 uncovered pair 重叠；本轮 raw blocker 减少 12，与 6 个动作绑定和 6 个 pair 的精确消减一致。全项目仍有 37 个 orphan wrapper、3 组 duplicate mutation route、1 个 Web 主请求无 Nest 对应及后续业务组 blocker，不能把普通 `--check` 退出 0解释为整站 ready。

## 6. 验证回执

- TDD RED：新增“保存前 capability 被撤销”用例，旧实现预检调用为 0 且继续写入。
- Web 聚焦：`use-contract-draft.test.ts` 74/74。
- API 聚焦：合同草稿 aggregate service/controller 2 套 41/41。
- 页面动作检查器：72/72，含后台预检正例与“写请求先于检查”反例。
- 综合矩阵检查器：44/44。
- API/Web typecheck、lint：通过。
- Web `check:ui`：通过。
- API build、检查器语法、六份生成清单普通 check：通过。
- 当前生成事实：401 routes、391 wrappers/411 bindings、64 actions、0 unclassified、237 uncovered pairs、14 unresolved bindings、294 raw blockers。

已推送的上一个候选 SHA `31ed0e89a03f9d2c38489426dfb50d0b99d604a2` 对应 GitHub Actions run `30787910399` 已于 2026-08-03 完成并为 `success`。本轮 C-P0-02a 是其后的新本地变更，不能复用该 CI 回执，且未获得新 SHA 的推送授权。

## 7. 下一步与边界

下一步执行 `C-P0-02` 第 2 组：草稿创建、提交、负责人转移与工作台治理，精确目标为 7 个未覆盖 pair 和 2 个未闭合绑定。完成后重新生成同一组清单并按真实数字更新本回执链。

本轮不授权：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。
