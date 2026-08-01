# 实施包 5 Task 11：聚合工作台替代路由与旧供应商余额写路由分类

日期：2026-08-01

范围：纯本机静态分类、孤儿 Web 包装清理、治理清单与测试；未连接生产，未执行迁移、部署、业务写入或物理删除。

## 结论

本切片只把以下 11 条后端路由登记为 `exit_candidate`。所有路由均固定
`deletionAuthorized=false`，后端 controller、service、Schema、历史事实、文件和审计继续保留：

1. `DELETE /contract-workbench/:contractVersionId/parties/:partySnapshotId`
2. `GET /contracts/:contractVersionId/authorizations/readiness`
3. `PATCH /contract-workbench/:contractVersionId/parties/:partySnapshotId`
4. `POST /contract-bill-imports/:importId/apply`
5. `POST /contract-bills/:billId/excel-imports`
6. `POST /contract-workbench/:contractVersionId/parties`
7. `POST /contracts/:contractVersionId/approval-submission`
8. `POST /me/signature`
9. `POST /spot-procurement-payments/:paymentId/balance-execution`
10. `POST /spot-procurements/:procurementId/supplier-balance-credit`
11. `PUT /contract-bills/:billId/rows`

这不是 Task 12 的删除授权，也不是生产零调用证明。

## 替代路径与停写依据

| 旧路由组 | 当前真实路径或规则 |
| --- | --- |
| 合同主体 POST/PATCH/DELETE | 主体集合随 `PUT /contract-drafts/:contractVersionId` 聚合保存；统一使用 owner、租约、合同级 revision、幂等回执和整单事务。 |
| 授权专项 readiness GET | 当前工作台使用综合 `POST /contracts/:contractVersionId/readiness`，综合读取双方授权、正式文件和其他提交阻断。 |
| 旧 approval-submission | 当前工作台使用 `POST /contract-drafts/:contractVersionId/submission`，强制编辑租约、`expectedRevision` 和幂等键。 |
| 旧清单 Excel preview/apply 与整表 PUT | 当前页面使用 `POST /contract-drafts/:contractVersionId/bills/:billKey/import-preview` 取得无写候选，确认后并入本地 aggregate，再由顶层聚合保存。 |
| 旧图片签名上传 | 当前设置与审批链使用 `/me/signature/canvas` 的不可变签名版本；旧上传仅保留历史 `signatureFileId` 兼容事实。 |
| 供应商余额转入/执行 | 最新零采 real-form 明确取消供应商余额，只允许补货或退款；两条旧路由继续服务 legacy 历史闭环，不向新 A4/A5 页面开放。 |

只被单元测试引用、没有生产页面消费者的旧 Web 包装已删除；保留后端兼容能力和历史只读投影。

## 失败证据

先修改治理基线测试，要求上述 11 条路由成为退出候选、未分类只保留 5 条现行业务能力；在登记 registry 前，目标检查器为 36/37，精确显示 11 条实际仍为 `unclassified`。

登记后仍保留为未分类的 5 条路由是：

- `POST /contract-bills/:billId/rows/:rowKey/remainder-cancellation`
- `POST /contracts/:contractVersionId/signing/material-change`
- `POST /projects/:projectId/financing-quotas`
- `POST /projects/:projectId/financing-quotas/:quotaId/approval`
- `POST /projects/:projectId/financing-quotas/:quotaId/termination`

这 5 条均是现行产品能力，必须分别补服务端 capability、真实页面动作、fresh preflight、权限/金额/状态/审计测试；不得为了把数字归零而标成退出候选。

## 验证证据

- 先行 RED：路由用途检查器 36/37，精确列出 11 条仍为 `unclassified`；登记后
  37/37 通过。
- 目标 Web API：2 个文件、163/163 通过。
- Web 全量：152 个文件、1523/1523 通过。
- Web typecheck、lint、`check:ui`、production build：通过。
- API production build：通过；本切片未修改 API 生产代码。
- 六套治理检查器：203/203 通过。
- Web API、页面动作、路由用途、综合能力矩阵四清单 write/check：通过。
- 合同专项能力矩阵检查器：18/18 通过，Node 语法与实际 write/check 通过；矩阵从
  route-usage 读取 24 条合同专项退出候选，均显示“候选退出 / 物理删除授权否”，同时保留
  生产零调用和独立删除授权两门。旧 `legacy_candidate` 即使具备 runtime manifest 与生产
  零命中，也最多进入“候选退出”，不再产生“删除 / 授权否”的矛盾结果。
- `git diff --check`：通过。
- 当前指标：379 个 Web wrapper、391 个 request binding；395 条后端路由，其中 43 条
  `exit_candidate`、5 条 `unclassified`；49 个页面动作、296 个 page blocker、322 个
  matrix blocker。
- 43 条退出候选逐条重算，`deletionAuthorized` 非 `false` 的数量为 0。
- 被移除的 7 个 wrapper、相关专属 payload/error parser 及旧上传 helper 在 Web 生产源中
  无剩余引用；聚合清单网格仍使用的行输入、行回执与校验错误类型继续保留。
- 独立复核先发现静态调用清单漏列旧清单 preview/apply 的 P1，以及专项矩阵仍显示“补入口”
  和 legacy 分支可无独立授权输出“删除”的 P2/P1；三项均已修复并重跑检查器。

## Task 12 之前仍缺失的证据

- 生产只读日志在批准观察窗口内的逐路由零调用证据尚未取得。
- 静态零调用尚未成立，现有本地验证脚本仍明确调用 4 组本次候选路由：
  - `services/api/prisma/verify-contract-workbench.cjs` 调用旧清单
    `POST /contract-bills/:billId/excel-imports`、
    `POST /contract-bill-imports/:importId/apply`、旧 parties POST 和旧
    approval-submission；
  - `services/api/prisma/verify-core-flow.cjs` 与
    `services/api/prisma/run-contract-settlement-governance-uat.cjs` 也调用旧
    approval-submission。
  因此未来运行这些 verifier 仍会产生旧路由命中；本切片没有把静态零调用或 Task 12
  观察窗伪装为已完成。
- 负向退役响应、生产备份恢复和用户对精确删除集合的独立授权均未取得。

因此本切片只完成 Task 11 分类，不进入 Task 12，不删除任何路由、旧表、旧字段或历史事实。
