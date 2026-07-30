# 实施包 5 Task 11：全站 Web API 封装与真实消费者清单

日期：2026-07-30

状态：Task 11 第二份 machine-readable manifest 已本地完成盘点并保持
`blocked`；页面动作清单、路由用途分类和最终能力矩阵仍未完成。

## 本切片范围

本切片扫描全部 `apps/web-admin/src/api/*.api.ts`，登记：

- 导出函数及其 API 文件；
- 经本地 helper 传播后的 HTTP method、path 和 body 类型；
- 有限 literal union 展开后的确定请求绑定；
- 下载票据返回 URL 的二次 GET；
- 从 `apps/web-admin/src/main.ts` 出发可达的真实页面/composable 消费者；
- 单测消费者、不可达消费者和完全未引用 wrapper；
- 与 `nest-business-routes.json` 的规范化 method/path 对照；
- `auth.store.ts` 中五条直接认证 transport 例外。

检查器使用 TypeScript AST 做有限抽象解释，能够穿透 `readJson`、`sendJson`、
`writeJson`、`requestDraft`、`jsonPost`、path helper、`encodeURIComponent`、
模板字符串、字符串拼接、条件表达式和有限 method/path union。Vue 生产消费者
只有在脚本中真实调用、作为可追踪 callback/dependency 传递，或在模板指令中
使用时才成立；`void wrapper` 和普通死引用不会冒充真实消费者。

`apiFetch` import alias 和直接 `fetch` 会被识别。未知 HTTP method、跨 API
模块 transport 委托、可疑网络 client、`XMLHttpRequest`、`EventSource` 和
`WebSocket` 不会被误标为纯函数，而是作为 unresolved transport 失败关闭。

## RED、实现与复核修复

首轮 RED 为核心 helper 不存在时的 `ERR_MODULE_NOT_FOUND`。随后以夹具逐步锁定：

1. helper 参数和 `"POST" | "PATCH"` 有限联合传播；
2. 嵌套 `normalize(await postJson(...))` 不丢失主请求；
3. 票据 URL 与主 API 请求分开登记；
4. JSON、FormData、无 body 及 JSON 字符串 body 分类；
5. 生产入口可达性、单测/不可达/未引用消费者分离；
6. orphan、重复写、dangling route 和未知 method 失败关闭；
7. auth transport 必须与 Nest route 对照；
8. blocked 报告可写入/核对，而 `--require-ready` 必须失败。

首轮独立复核发现三项 P1：

- 死引用可能冒充真实消费者；
- `apiFetch` alias 或未知 transport 可能消失为 pure export；
- ready CLI 可能信任陈旧 Nest JSON。

第二轮对抗性复核又发现两项 P1：

- 未被使用的本地 alias 链仍可能冒充真实消费者；
- 通用 `./transport` 委托仍可能消失为 pure export。

现已分别改为真实调用/callback/模板指令证据、alias taint 的最终调用证明、
递归本地 transport 检查及未知网络委托 fail-close，并让 canonical ready 命令
先重建、核对 395 条 Nest route；直接 `--require-ready` 在 Web 报告为 ready
时也会重新读取当前构建产物并核对 Nest baseline。复核前估算的 384 组消费者
关系经独立重算为 385 组；三组可疑项是实际 dependency injection，另四组是
实际 Vue 模板事件调用，不是死引用。最终独立复核结论为 READY，无剩余
P0/P1/P2。

## 生成结果

基线文件：

`docs/product/manifests/web-api-wrappers.json`

SHA-256：

`1ba5cd46715804454ce6d414273fe273cac8e431eb871278e7c9b76ae95294cb`

| 指标 | 结果 |
| --- | ---: |
| schemaVersion | 1 |
| API module | 14 |
| exported function | 374 |
| transport wrapper | 371 |
| pure export | 3 |
| main request binding | 372 |
| ticket follow-up | 2 |
| request call-site edge | 373 |
| production source module | 236 |
| 从 `main.ts` 可达模块 | 229 |
| 有生产消费者的 wrapper | 327 |
| wrapper/生产消费者文件关系 | 385 |
| 只有单测消费者 | 42 |
| 完全未引用 | 2 |
| duplicate normalized route group | 6 |
| duplicate write group | 4 |
| auth transport exception | 5 |
| unresolved request | 0 |
| auth route 缺 Nest 对照 | 0 |
| consumer parser issue | 0 |

当前报告必须保持 `blocked`，原因是：

- 44 个 transport wrapper 没有生产消费者，其中合同工作台 21 个、核心流程
  21 个、零星采购 2 个；
- 4 组同一路由重复写封装尚未按 Task 12 退出或确定唯一 canonical wrapper；
- `createSpotProcurementPaymentDraft` 仍请求
  `POST /spot-procurements/:param/payments`，但当前 Nest manifest 已无该路由。

另外两组重复 GET 封装记录在完整 duplicate inventory 中，但不冒充计划所说的
“同义写封装”失败项。报告不自动删除 wrapper，也不替业务负责人选择 canonical
入口。

## 验证

- `node --test scripts/inspect-whole-site-web-api-manifest.test.mjs`：10/10；
- `node scripts/inspect-whole-site-web-api-manifest.mjs --write`：生成 blocked
  baseline；
- `node scripts/inspect-whole-site-web-api-manifest.mjs --check`：baseline 一致；
- `pnpm run inspect:whole-site-web-api`：blocked baseline 一致，退出码 0；
- `CI=true pnpm run inspect:whole-site-web-api:ready`：先重建 shared/API 并
  通过 395 条 Nest route 核对，再因上述 Web blockers 按预期退出码 1；
- 三个新增 `.mjs` 文件 `node --check`：通过；
- `git diff --check`：通过。

## 未完成项与边界

本切片是 Task 11 的事实盘点，不是 Task 11 完成，也不授权立即删除 orphan 或
dangling wrapper。下一顺序仍是：

1. 生成页面可见动作、handler 链、服务端 capability/action key 与 wrapper
   绑定清单；
2. 登记每条后端业务路由的页面、内部任务、外部接管或退出分类；
3. 生成 `docs/product/whole-site-capability-matrix.md`；
4. 按 Task 12 对已确认的旧接口集合逐组建立零调用证据和独立回退点。

本切片未连接生产、未 push、未合并、未部署、未执行生产迁移、未修改生产业务
数据，也未执行 retention 或任何物理删除。
