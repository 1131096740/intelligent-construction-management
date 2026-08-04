# 2026-07-30 整站能力矩阵

## 结论

Task 11 的最终交叉矩阵已生成，但当前状态为 `blocked`，不能作为发布就绪证据。

矩阵只交叉核验以下四份输入，不授予删除、生产写入或发布权限：

- Nest 业务路由清单
- Web API wrapper 清单
- 页面动作与服务端能力清单
- 路由用途分类清单

## 当前基线

| 输入 | 状态 | SHA-256 |
| --- | --- | --- |
| Nest 路由 | ready | `62580430a97217233e458e2246bf76144c9f2c83e62ab8dce56d6cecc68a3a80` |
| Web API wrapper | blocked | `1ba5cd46715804454ce6d414273fe273cac8e431eb871278e7c9b76ae95294cb` |
| 页面动作 | blocked | `d4275841ab9f230f091e92eb1f07e6abf0d80d11cb506dad1e8842467dc8569b` |
| 路由用途 | blocked | `30ef88cefc133300f6ba65e8cefc360f282b949b43ea5f94f5e84818bb38e736` |

矩阵覆盖 395 条路由：

- 页面路由 279 条
- 历史接管路由 59 条
- 退出候选 23 条
- 内部任务 2 条
- 未分类 32 条

当前共有 392 个矩阵阻塞项：

- 上游清单未就绪 3 项
- Web 主请求无 Nest 路由 1 项
- 孤儿 wrapper 44 项
- 重复写入路由 4 组
- 未分类路由 32 条
- 未覆盖生产写入消费者 269 对
- 未解决动作绑定 39 个

所有 23 条退出候选仍为
`candidate_only_no_deletion_authorization`，矩阵的
`deletionAuthorized` 固定为 `false`。

## 门禁行为

- 普通 `--write` 与 `--check` 可以保存并复核真实的阻塞基线。
- `--check --require-ready` 会重新计算并核对四份上游输入。
- `--write --require-ready` 在读取或写入任何产物前直接拒绝。
- JSON 与 Markdown 均由同一个内存对象确定性生成，任一文件漂移都会失败。

## 验证

- `node --test scripts/inspect-whole-site-capability-matrix.test.mjs`
  - 34/34 通过
  - 包含 20 类以上 RED fixture
- 三个新增脚本均通过 `node --check`
- 真实 `--write` 通过
- 真实 `--check` 通过
- 真实 `--check --require-ready` 按预期失败；当前首先命中
  `ROUTE_MANIFEST_BUILD_STALE`，同时矩阵内三个上游状态仍为
  `blocked`
- `git diff --check` 通过

产物 SHA-256：

- JSON：
  `6316febbced4c872f18b27aad5eb1bda0f5dd1bb53536fe8e531bc3a19242f08`
- Markdown：
  `5da585066e5b74b7173aa333fa90ddca72fff5c1df28eb93e17d2d9ea6a3878f`

## 独立对抗复核修复

首轮只读复核发现两项可形成伪 ready 的 P1：

1. 同一 wrapper 同时含 GET 与 POST 时，GET 动作的 accepted consumer 可按
   wrapper/consumer 粒度误覆盖 POST；
2. `authTransportExceptions` 只核对数量，伪造的悬空 Auth route 可以清空上游
   blocker 后穿过矩阵。

修复后，写覆盖按 `wrapper + consumer + mutation normalizedKey` 逐项锁定，同一
wrapper 的全部 mutation request 都必须由对应的获准 mutation binding 覆盖；
Auth transport 则逐条对照 Nest，并重新派生/精确核对
`authWithoutBackend`。同时补齐 request-edge 数量重算、两份 registry 精确路径、
route-usage override digest 重算和页面 evidence 的内部/跨 Web 一致性约束。
第二轮复核继续发现 write semantic 绑定纯 GET 仍可被标记 accepted；现将所有非
mutation binding 固定登记为 unresolved，不能成为获准页面动作。上述缺口均有
RED，当前 34/34 通过。最终独立复核逐项重放三条绕过后结论 READY，无剩余
P0/P1/P2。
