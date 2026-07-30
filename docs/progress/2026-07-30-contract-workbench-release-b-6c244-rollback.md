# 合同工作台 Release B `6c244a1b` 回滚与空引用归一化修复收据

日期：2026-07-30

授权候选：
`6c244a1bf019f2a046660a9dbf331a2d32e2d623`

授权范围：候选分支 push、`main` fast-forward、生产 checkout、完整人工确认部署、
三个既定 canary，以及四账号各一枚新的 120 秒内存 access token 和原烟测范围。

未授权且未执行：transition、retention、烟测范围外业务写入和任何物理删除。

## 1. Git、生产前态与只读预检

- 候选分支、GitHub `main`、本地 `main` 和生产 `/opt/jiangkong` 均严格
  fast-forward 到获批 SHA，生产 checkout 洁净；
- `a0bbfacb5008abbcb255a96c79cb0bd05c76db56` 和上一生产 checkout
  `d5bd7d54f6af7f49735a2c2c53f1020e712d558b` 均为候选祖先；
- 发布前生产为 `maintenance`、canary 0；
- API、Nginx、PostgreSQL active，回环与公网 health 均为 `status=ok`；
- retention timer inactive，精确部署决定文件不存在；
- 根权限只读前检 `checkedAt=2026-07-30T06:41:26.345Z`：
  - 目标版本 `722bb87e-700d-40d2-95b5-c82604cfb92c`；
  - `draft`、revision 12、正式编号空、首次提交时间空；
  - 审批 0、活跃租约 0、活跃保存回执 0、项目接管 0；
  - 批次 `contract-draft-aggregate-20260730-r12` 的 transition 审计恰好 1；
  - 合同主管、财务主管、当前经办人和非 canary 合同专员哈希与授权一致。

## 2. 完整人工确认部署

生产切到 `release-b-maintenance` 并配置精确三个 canary 后，
`verify-production-readiness.cjs` 含数据库状态检查全项通过。API 重启后回环、公网
health 和服务状态均通过。

部署器以：

```text
CANDIDATE_SHA_CONFIRMATION=6c244a1bf019f2a046660a9dbf331a2d32e2d623
DEPLOY_SCOPE=full
DEPLOY_CONFIRMATION_MODE=manual
DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=1800
```

完成：

- API/Web 生产构建；
- Prisma Client generate；
- Nginx 配置校验；
- 109 个迁移核对，无待执行迁移；
- API/Web 新运行时切换和 health；
- 进入精确决定文件等待窗口。

本次部署备份：

| 项目 | 结果 |
| --- | --- |
| 文件 | `jiangkong-20260730-144420.dump` |
| 大小 | 1,004,637 bytes |
| 权限 | `root:root 600` |
| SHA-256 | `51e3b8bdeca7ff8a1132edace260f9f894ad476bf0fcfc22373883aee66ef50c` |
| checksum | OK |
| `pg_restore --list` | 1,658 行 |
| 异机收据 | `backupObjectKey`、`checksumObjectKey` 和 `backupSha256` 均匹配 |

## 3. 一次性 token 与烟测

无 token 前置校验：

- `checkedAt=2026-07-30T06:45:16.504Z`；
- revision 12；
- 活跃租约/回执、审批和接管均为 0；
- 内容相同载荷 SHA-256：
  `fca4e9f9a8eed7388578eee437dfee29915798d420c02c157efe024d35a86074`；
- 四账号哈希与授权一致。

唯一一次烟测于 `2026-07-30T06:45:32Z` 为四账号各签发一枚 120 秒内存
access token。未生成 refresh token、未调用登录接口、未输出或持久化 token。

保存前已通过：

- 当前经办人聚合工作台 GET 200；
- 非 canary 新写 503 `CONTRACT_CUTOVER_MAINTENANCE`；
- 旧工作台 PATCH 410；
- 旧单确认 410；
- 财务主管接管读取 200 且为空；
- 财务主管接管写入 403；
- 仅当前经办人取得编辑租约。

唯一一次内容相同聚合保存返回 HTTP 200，但响应 revision 为 13，违反授权要求
“revision 必须保持 12”，烟测立即以：

```text
aggregate save changed revision
```

失败。脚本未重签、未重跑、未继续其他写操作。

## 4. 回滚与生产终态

发现失败后立即：

1. 将环境恢复为 `maintenance`；
2. 清空 canary；
3. 写入精确
   `ROLLBACK 6c244a1bf019f2a046660a9dbf331a2d32e2d623`；
4. 由部署器恢复部署前 API/Web 运行时并检查 health。

`2026-07-30T06:47:48.549Z` 的根权限脱敏失败收据证明：

- 四枚 token 已自然过期；
- 编辑租约已自然过期，活跃租约 0；
- 目标草稿 revision 已由 12 变为 13；
- 唯一有效技术保存回执为本次幂等键，`expectedRevision=12`、
  `resultRevision=13`，到期时间 `2026-08-06T06:45:32.886Z`；
- 唯一变化区段为 `negotiation_documents`；
- 新增一条 `contract.draft.save` 审计，记录 revision 12→13 和同一变化区段；
- 审批 0、项目接管 0、正式编号空、首次提交时间空；
- transition 审计仍为 1。

该 revision、空工作台引用对象、技术回执和保存审计属于本次已执行请求的实际生产
结果。回写 revision 12、改写草稿 JSON、清理回执或审计均属于新的生产业务写入或
物理删除，未获授权，因此没有执行。

生产终态：

- checkout 洁净并保持获批 SHA，运行时已恢复部署前快照；
- 环境为 `maintenance`、canary 0；
- API、Nginx、PostgreSQL active，回环与公网 health 正常；
- 本次窗口后的 API error/warning 优先级日志均为 0 行；
- retention timer inactive；
- 精确决定文件已由部署器清理，临时回滚目录为 0。

生产证据目录：

`/srv/jiangkong-release-b-evidence/6c244a1bf019f2a046660a9dbf331a2d32e2d623/release1/`

其中脱敏终态证据为 `failure-state.json`。烟测脚本原本仅在非 200 响应时写
`smoke-failure.json`；本次是 HTTP 200 后的业务守恒失败，因此另由只读诊断生成该
收据，没有补发 token 或重新调用保存接口。

## 5. 根因与最小修复

transition 后的目标草稿没有 `draftData.workbenchReferences`。聚合客户端用完整读模型
回传“没有所选磋商轮次、没有所选线下修订、引用文档数组为空”的等价空引用。
服务端旧比较直接比较：

```text
null
```

与：

```json
{
  "selectedNegotiationRoundId": null,
  "selectedOfflineRevisionId": null,
  "referencedGeneratedDocumentIds": []
}
```

因此把语义相同的引用误判为 `negotiation_documents` 变化并增加 revision。

新增 RED 直接使用“数据库无引用对象 + 已验证聚合 DTO 回传空引用”，修复前精确失败：

```text
Expected workbenchReferencesChanged: false
Received workbenchReferencesChanged: true
```

最小实现只为比较建立规范化引用视图：缺失对象、缺失字段和显式 null/空数组按同一
空语义比较；非空磋商轮次、线下修订和生成文档 ID 仍逐项比较。原始存储、权限、
金额、CAS、审计、事务和真实引用变更行为均未放宽。

运行代码提交：
`9e6c8b44b49c0f7b43784b8f6b3fd38412eced8b`

## 6. 修复验证与下一发布门

- 完整验证树：`9afc82f95a3b769d68b2a139832f2866074d9683`；
- 精确 RED：1 失败，错误与生产根因一致；
- GREEN：合同工作台与聚合保存 84/84；
- API：251 套、4,751/4,751，另有 15 套/38 项条件跳过；
- shared-domain：149/149；
- Web：139 个文件、1,248/1,248；
- 整仓 typecheck、lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API/Web build：通过；
- Prisma generate、validate：通过；
- 业务错误扫描：396 个生产 TypeScript 文件，55 个既有内部英文哨兵；
- 能力矩阵：184 个静态控制器路由、138 个 Web API 请求、395 个运行时路由，
  差异 0；
- P0 Chromium：2/2，另 2 项按真实环境变量条件跳过；
- 清单焦点：Chromium/WebKit 桌面及 960/640/375，8/8；
- 跨版本清单映射与主任确认：1/1；
- PostgreSQL 16 临时隔离空库顺序应用 109/109 迁移，状态最新；同批
  transition 首轮 4 写，第二轮 0 写，业务计数守恒，临时容器和目录已清理；
- `git diff --check`：通过；
- 本修复不改变 Prisma Schema、迁移树或 Web 运行代码。

`6c244…` 的 push、部署、canary 和 token 授权已经消耗，不能延伸到包含本修复的新
候选。再次进入 Release B 前必须先由用户明确选择并授权生产基线处理方式：

1. 追加可审计的纠正写入，将空引用与 revision 恢复到批准前业务状态；或
2. 接受 revision 13 和现有七天技术回执为新基线，并为下一次烟测重新约定守恒值。

两种方式都不能隐含执行。新的完整候选 SHA、三个 canary、四账号新一轮 token 和
可能新增的技术回执必须分别重新授权。transition、retention、其他业务写入和物理
删除继续关闭。
