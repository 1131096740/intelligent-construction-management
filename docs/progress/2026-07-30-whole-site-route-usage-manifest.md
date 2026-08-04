# 实施包 5 Task 11：全站后端路由用途与消费面清单

日期：2026-07-30

状态：Task 11 的 route-usage 切片已完成本地事实盘点并通过最终独立复核；
生成清单按事实保持 `blocked`，因为仍有 32 条后端路由没有经人工确认的用途分类。

## 本切片范围

本切片以版本化的 Nest 路由清单、Web API wrapper/真实消费者清单和人工复核
registry 为输入，为全部 395 条精确 Nest 路由登记：

- `page`、`external_takeover`、`exit_candidate`、`internal_task` 或
  `unclassified` 用途；
- 与用途相互独立的 `consumerSurface`；
- production Web wrapper、auth store、下载票据后续请求或人工消费面证据；
- 精确 method/path、规范化 route identity 和来源 controller/handler；
- 分类来源、分类理由、消费证据及 blocker。

普通 `page` 只能由从 Web 正式入口可达的生产 wrapper 或 auth store 请求推导。
`GET /files/:fileId/download` 是唯一人工登记的 page：它必须同时匹配指定
API 文件、wrapper、后续 GET 和 ticket 字段，不能把任意下载 URL 冒充为页面
主请求。健康检查和受控运维入口分别登记为 machine/operator 消费面，不伪装成
页面流量。

本清单的授权范围仅为 `route_usage_classification_only`。它不替代 service/
transaction 内的资源授权、业务不变量或生产零调用观察。

## 真实基线

| 指标 | 结果 |
| --- | ---: |
| Nest route | 395 |
| exact method/path | 395 |
| normalized method/path | 395 |
| 人工分类 override | 85 |
| 人工消费面 override | 3 |
| `page` | 279 |
| 其中 production Web 自动推导 | 278 |
| `external_takeover` | 59 |
| `exit_candidate` | 23 |
| `internal_task` | 2 |
| `unclassified` | 32 |
| blocker 总数 | 32 |

59 条外部接管路由精确由 `ContractTakeoverController` 40 条和
`ProjectController` 19 条组成。32 条 `unclassified` 是当前唯一非零 blocker
集合；没有把缺证据的路由猜成 page、退出候选或内部任务。

## Consumer surfaces

`consumerSurface` 与 route usage 独立登记，当前分布为：

| consumerSurface | 路由数 |
| --- | ---: |
| `web_api_wrapper` | 326 |
| `auth_store` | 5 |
| `signed_ticket_delivery` | 1 |
| `machine_probe` | 1 |
| `operator_endpoint` | 1 |
| `none` | 61 |

六类消费面合计 395 条。唯一 signed-ticket delivery 是
`GET /files/:fileId/download`；machine probe 是 `GET /health`；operator
endpoint 是 `POST /draft-retention/controlled-entry`。

## 六条精确归属

最终审计设计中的六条易混淆路由已按 exact method/path 固定，并由测试逐条
锁定：

| 路由 | 用途 |
| --- | --- |
| `GET /projects/affiliate-mapping-report` | `external_takeover` |
| `POST /projects/:projectId/affiliate-assignment` | `external_takeover` |
| `POST /projects/:projectId/receipts` | `exit_candidate` |
| `POST /projects/:projectId/proxy-payments` | `exit_candidate` |
| `POST /contract-bill-imports/:importId/apply` | `unclassified` |
| `POST /contract-bills/:billId/excel-imports` | `unclassified` |

前两条属于挂靠/历史事实的外部接管工作台；中间两条是已返回 410 的旧资金录入
候选；后两条在没有新的人工决定前继续失败关闭，不从相似名称推断为退出候选。

## 三项 SHA

| 证据 | SHA-256 |
| --- | --- |
| 85 条人工分类 exact membership 摘要 | `0e5c372a55f6e9edbafe5bf1dee1e41e50fff618731220c24ab7aed8e6e3f537` |
| `docs/product/manifests/route-usage.registry.json` | `d9be26123ddb1ff0a8d7644437b2615676be30446c7843d7277b18120a60b571` |
| `docs/product/manifests/route-usage.json` | `30ef88cefc133300f6ba65e8cefc360f282b949b43ea5f94f5e84818bb38e736` |

分类 exact membership 的摘要使“数量不变但成员互换”也会失败，不允许只靠
59/23/32 的总数通过检查。生成 JSON 不写墙钟时间，重复生成保持字节级确定。

## 失败关闭与独立复核

检查器会拒绝 stale/重复 registry、重复 exact 或 normalized Nest route、
Nest/Web identity 矛盾、未知 request kind、重复 wrapper/request identity、
相互冲突的 wrapper/auth 消费面以及不属于指定 wrapper 的 signed-ticket
follow-up。

ready 模式不信任现成 JSON：先重算并核对 Web manifest，确认其 ready 后再重算
并核对 Nest manifest。route-usage 自身仍有 32 条未分类路由，因此不具备 ready
条件；blocked 证据可以稳定写入和核对，但不能被提升为 ready。

独立只读复核最终确认无剩余 P0/P1/P2。复核独立重算了 59 条 external、
23 条 exit、32 条 unclassified、40+19 external controller 分布、六条精确归属
和摘要；此前 request identity 把 `sourceLine` 纳入去重键的问题也已移除并有
不同源码行的重复请求负测。

## 验证

- `node --test scripts/inspect-whole-site-route-usage-manifest.test.mjs`：
  37/37；
- 三个新增 `.mjs` 文件 `node --check`：通过；
- registry 与生成清单 JSON 解析、LF/单个末尾换行和尾随空白检查：通过；
- `node scripts/inspect-whole-site-route-usage-manifest.mjs --write`：
  生成 `395 routes, 32 unclassified` 的 blocked baseline；
- `node scripts/inspect-whole-site-route-usage-manifest.mjs --check`：
  baseline 一致，退出码 0；
- `node scripts/inspect-whole-site-route-usage-manifest.mjs --check
  --require-ready`：因失败关闭门退出非零；32 条未分类路由仍足以阻断 ready；
- 重复 `--write` 后 registry 与生成清单 SHA-256 不变；
- `git diff --check`：通过。

## 边界

`exit_candidate` 只表示 Task 12 的候选事实，全部 23 条均固定为
`consumerSurface=none`、`deletionAuthorized=false`，并带有
`candidate_only_no_deletion_authorization` 语义。410、无生产页面消费者或
人工分类都不等于删除授权。

本切片未连接生产、未读取或修改生产业务数据、未执行生产观察、迁移、retention
或物理删除，也未 push、合并、提交或部署。任何旧接口退出仍必须在 Task 12
按逐组零调用证据、人工确认和独立回退点另行执行。
