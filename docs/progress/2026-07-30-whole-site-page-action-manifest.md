# 实施包 5 Task 11：页面动作、服务端能力与 API 绑定清单

日期：2026-07-30

状态：Task 11 第三份 machine-readable manifest 已完成本地事实盘点并保持
`blocked`；后端路由用途分类与最终
`docs/product/whole-site-capability-matrix.md` 仍未完成。

## 本切片范围

本切片新增：

- 人工复核过的页面动作/background action registry；
- 从 `apps/web-admin/src/main.ts` 出发的 Web 生产 import graph；
- Vue SFC template event、prop callback、ancestor `v-if`/`v-show`、禁用条件与
  有限 literal variant 检查；
- 页面动作到 Web API wrapper、main request、Nest normalized route 的三段对照；
- 服务端 `availableActions`/detail action/server boolean/edit lease 对页面写动作
  的支配证明；
- `mutation wrapper × production consumer` 反向覆盖清单；
- 对本地角色/状态放行、无服务端 capability、动态/无法证明的组件透传、孤立
  production write consumer 的失败关闭门。

清单只证明 `ui_capability_binding_only`。Nest 侧仍只表示
`guard_metadata_only`；两者都不替代服务层资源授权、事务不变量或生产岗位验收。
`availableActions.key` 与 Nest `requiredProjectAction` 属于不同命名空间，只通过
wrapper 的 method/path 精确对照，不按名称相似度推断。

## RED 与最小实现

首次执行：

```text
node --test scripts/inspect-whole-site-page-action-manifest.test.mjs
```

因核心库尚未导出 `inspectWholeSitePageActionManifest` 而以
`ERR_MODULE_NOT_FOUND`/named export 错误失败。首轮先以 7 组夹具锁定：

1. 服务端能力门下的按钮可精确联结 wrapper 与 Nest route；
2. approve/reject variant 可共享 action key 与 wrapper，但仍保留两个可见动作；
3. 本地角色/状态作为唯一业务写门时必须阻塞；
4. wrapper 或 Nest route 缺失时必须阻塞；
5. 有生产消费者的 mutation wrapper 未登记动作/background 分类时必须阻塞；
6. 下载 ticket 后续 GET 单列，不伪造成 Nest controller route；
7. JSON 输出、write/check 确定，`--require-ready` 对 blocked baseline 必须失败。

实现后又按真实源码和多轮独立对抗性复核逐项加 RED。复核曾发现：

1. 页面动作与 wrapper 只同文件出现并不能证明因果调用；
2. registry 自报 capability、blocked/stale 上游 manifest、矛盾 method/path/Nest
   身份和死路由语法均不能成为 ready 证据；
3. invalid action 不能计入 accepted coverage，`--write --require-ready` 不能先
   覆盖已有文件再失败；
4. 被丢弃的 GET/HEAD 调用不能伪造 capability provenance；
5. 仅作为事件参数出现的 wrapper、`return` 后及静态假分支中的调用不能成为动作
   调用链；
6. `webAdminRoutes` 必须精确进入 `createRouter`，且该 router 必须由
   `createApp` 返回的 Vue app 实例实际 `use`，不能凭 dead export、side-effect
   import 或任意对象的 `.use(router)` 伪造；
7. literal/unknown 控制流、logical assignment、optional chain、默认值、延迟
   instance field 及 class static abrupt completion 都不能制造不可达调用链；
8. Vue app、`createApp`、`createRouter`、router 和 `webAdminRoutes` 的赋值、
   解构写、参数/模板逃逸、危险成员别名、direct eval 都必须失败关闭；
9. 受保护 router/routes 对象的其他 reachable import consumer、re-export 链和
   字面量/非字面量 dynamic import 都不能绕过完整性检查；
10. 必然 throw/无限循环的本地 helper、函数 alias、对象方法、作用域重名、IIFE
    和 class static 初始化必须把终止事实传播到后续 wrapper 调用。

对应最小实现还包括：

- `BusinessDraftAction` 仅在 canonical 组件可静态证明从 enabled action 集合取值、
  禁用项不可点击、最终调用 `props.execute(action.key)`，且 registry variant 与
  capability key 相同时才认可 prop callback；
- reverse coverage 从 wrapper 聚合收紧为 wrapper 与每个 production consumer
  的笛卡尔事实对照；
- 对话框写操作登记真正的 `:on-confirm` 终端 callback，不把“打开对话框”当作写入；
- `JgPageHeader` 的 `v-bind="props"` 未做有限 spread 证明，固定保留 blocker；
- template event 指标按指令位置去重，事件根只承认裸 handler 或真实 callee，
  不把表达式内任意 identifier 冒充按钮处理器。

## 版本化输入与输出

| 文件 | SHA-256 |
| --- | --- |
| `docs/product/manifests/nest-business-routes.json` | `62580430a97217233e458e2246bf76144c9f2c83e62ab8dce56d6cecc68a3a80` |
| `docs/product/manifests/web-api-wrappers.json` | `1ba5cd46715804454ce6d414273fe273cac8e431eb871278e7c9b76ae95294cb` |
| `docs/product/manifests/web-page-actions.registry.json` | `157c3e8d5695e477c834c6e19ee0481385de58cbbfa707b116346cdef3eba6a8` |
| `docs/product/manifests/web-page-actions.json` | `d4275841ab9f230f091e92eb1f07e6abf0d80d11cb506dad1e8842467dc8569b` |

Registry 共 36 项：30 个页面动作、6 个 background action。已登记的代表性正例
包括合同/结算纯净草稿删除与放弃、付款审批及实付、零星采购提交/审核、挂靠企业
合同登记/确认和项目支出审批/撤回；同时显式登记合同自动保存/手工保存/预览、
编辑租约以及结算保存/预览等不由单一按钮直接触发的写请求。

负例没有被删掉或伪装为可用：合同提交/转交、费用提交、付款申请创建、项目支出
新建/实付/财务/收款确认、历史接管新建/修改/送审等仍保留其当前本地角色或状态
门证据。

## 真实基线

| 指标 | 结果 |
| --- | ---: |
| Web 生产源码模块 | 236 |
| 从 `main.ts` 可达模块 | 229 |
| Vue SFC | 134 |
| 成功解析 Vue SFC | 134 |
| 可达 Vue SFC | 131 |
| 页面 route root | 47 |
| template event directive | 878 |
| prop callback directive | 12 |
| registry action | 36 |
| page action | 30 |
| background action | 6 |
| production mutation wrapper/consumer pair | 269 |
| 候选联结 pair | 33 |
| 已接受联结 pair | 0 |
| 未分类 pair | 269 |
| blocker 总数 | 347 |

当前 `blocked` 的精确构成为：

- 上游 Web API manifest 自身仍是 `blocked`，因此保留 2 条上游失败事实，不能把
  下游候选联结冒充 accepted coverage；
- 269 组 production mutation wrapper/consumer 尚未获得已接受的页面动作、
  后台动作或支持动作分类；
- 39 个 registry action 到 wrapper 的完整因果调用链仍无法静态证明；未完整
  建模的控制流会整体拒绝提供因果证明，而不会通过通用 AST fallback 猜测；
- 10 个已登记业务写动作仍只由前端角色/状态条件放行；
- 26 个已登记动作没有可证明的服务端 capability 门或其 capability provenance
  无法证明；
- `JgPageHeader.vue` 仍有 1 个 spread props/action 透传无法静态证明。

以下结构错误均为 0：非法/重复/stale registry、无法解析的 handler、缺失 Nest
route、源码 parse issue、动态 template event 与 route discovery issue。结构为 0
不等于清单已完整；当前 33 个联结只记为 candidate，0 个被 accepted，正是上游
blocked 与因果/能力证明仍未闭合时的失败关闭结果。

## 验证

- 核心与 CLI 目标测试：27/27；
- 四个新增 `.mjs` 文件 `node --check`：通过；
- `node scripts/inspect-whole-site-page-action-manifest.mjs --write`：
  生成 blocked baseline；
- `node scripts/inspect-whole-site-page-action-manifest.mjs --check`：
  baseline 一致；
- `pnpm run inspect:whole-site-page-actions`：baseline 一致；
- `--check --require-ready`：因真实 blockers 按预期退出非零；
- `git diff --check`：通过。
- 独立对抗性复核共十六轮；最终结论为 READY，无剩余 P0/P1/P2。

## 未完成项与边界

本切片不能称为 Task 11 完成，也不授权按 blocker 自动修改业务权限或删除 wrapper。
下一合法顺序是：

1. 为 269 组 production mutation wrapper/consumer 补齐经源码复核的页面、
   background、supporting 或退出分类，并修复本地角色/状态绕过；
2. 为全部 395 条后端业务 route 登记页面、内部任务、外部接管或退出分类；
3. 生成并核对 `docs/product/whole-site-capability-matrix.md`；
4. 只有在 Task 11 ready 后，才按 Task 12 的逐组零调用门执行已确认旧接口退出。

本切片未连接生产、未 push、未合并、未部署、未执行生产迁移、未修改生产业务
数据，也未执行 retention 或任何物理删除。
