# 合同工作台 Release B `d5bd7d54` 回滚与嵌套 DTO 修复收据

日期：2026-07-30

授权候选：
`d5bd7d54f6af7f49735a2c2c53f1020e712d558b`

授权范围：候选分支 push、`main` fast-forward、生产 checkout、完整人工确认部署、
三个既定 canary，以及四账号各一枚新的 120 秒内存 access token和原烟测范围。

未授权且未执行：transition、retention、其他业务写入和任何物理删除。

## 1. Git、生产前态与只读预检

- 候选分支、GitHub `main`、本地 `main` 和生产 `/opt/jiangkong` 均严格
  fast-forward 到获批 SHA，工作树洁净；
- `a0bbfacb5008abbcb255a96c79cb0bd05c76db56` 是候选祖先；
- 发布前生产为 `maintenance`、canary 0；
- API、Nginx、PostgreSQL active，回环与公网 health 均为 `status=ok`；
- 根权限只读前检 `checkedAt=2026-07-30T05:24:22.056Z`：
  - 目标版本 `722bb87e-700d-40d2-95b5-c82604cfb92c`；
  - `draft`、revision 12、正式编号空、首次提交时间空；
  - 审批 0、活跃租约 0、活跃保存回执 0、项目接管 0；
  - 批次 `contract-draft-aggregate-20260730-r12` 的 transition 审计恰好 1；
  - 合同主管、财务主管、当前经办人和非 canary 合同专员哈希与授权一致。

## 2. 完整人工确认部署

生产切到 `release-b-maintenance` 并配置精确三个 canary 后，
`verify:production-readiness` 全项通过。API 重启后的第一下 health 命中启动窗口，
11 秒后服务状态、启动日志、回环和公网 health 均通过，未进入部署前即已确认稳定。

部署器以：

```text
CANDIDATE_SHA_CONFIRMATION=d5bd7d54f6af7f49735a2c2c53f1020e712d558b
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
| 文件 | `jiangkong-20260730-132657.dump` |
| 大小 | 1,004,432 bytes |
| 权限 | `root:root 600` |
| SHA-256 | `76218c0ee5380bf09b38b102f1a96b98475b9534150c0ce4f65a45a09733ba12` |
| checksum | OK |
| `pg_restore --list` | 1,658 行 |
| 异机收据 | `backupObjectKey` 和 `checksumObjectKey` 均与本次文件匹配 |

## 3. 一次性 token 与烟测

无 token 前置校验：

- `checkedAt=2026-07-30T05:27:25.060Z`；
- revision 12；
- 活跃租约/回执、审批和接管均为 0；
- 内容相同载荷 SHA-256：
  `fc76b4fc365b4b94a99937e6937639e8c81137bcf368d8152aa34f14f6d755d6`；
- 四账号哈希与授权一致。

唯一一次烟测于 `2026-07-30T05:27:34Z` 为四账号各签发一枚 120 秒内存
access token。未生成 refresh token、未调用登录接口、未输出或持久化 token。

保存前已通过：

- 当前经办人聚合工作台 GET 200；
- 非 canary 新写 503 `CONTRACT_CUTOVER_MAINTENANCE`；
- 旧工作台 PATCH 410；
- 旧单确认 410；
- 财务主管接管读取 200 且为空；
- 财务主管接管写入 403；
- 仅当前经办人取得编辑租约。

唯一一次内容相同聚合保存返回：

```json
{
  "httpStatus": 400,
  "statusCode": 400,
  "code": "DRAFT_VALIDATION_FAILED",
  "message": "合同税务事实格式不正确，请刷新后重试"
}
```

脱敏证据位于：

`/srv/jiangkong-release-b-evidence/d5bd7d54f6af7f49735a2c2c53f1020e712d558b/release1/smoke-failure.json`

脚本未重签、未重跑、未继续其他写操作。

## 4. 回滚与生产终态

发现失败后立即：

1. 将环境恢复为 `maintenance`；
2. 清空 canary；
3. 写入精确
   `ROLLBACK d5bd7d54f6af7f49735a2c2c53f1020e712d558b`；
4. 由部署器恢复旧 API/Web 运行时并检查 health。

`2026-07-30T05:29:46.129Z` 的根权限终态收据证明：

- 四枚 token 已自然过期；
- 编辑租约已自然过期；
- revision 仍为 12；
- 活跃租约 0、活跃保存回执 0、失败幂等键回执 0；
- 审批 0、项目接管 0、正式编号空、首次提交时间空；
- transition 审计仍为 1；
- 生产 checkout 洁净并保持获批 SHA；
- 环境为 `maintenance`、canary 0；
- API、Nginx、PostgreSQL active，回环与公网 health 正常；
- 精确决定文件已由部署器清理。

生产证据目录：

`/srv/jiangkong-release-b-evidence/d5bd7d54f6af7f49735a2c2c53f1020e712d558b/release1/`

## 5. 根因与最小修复

全局 ValidationPipe 不仅把 `draft.clauses[]` 转成 DTO 实例，也会把
`draft.taxFacts` 和 `paymentTerms.stages[]` 转成嵌套 DTO 实例。聚合保存随后复用只
接受 plain object 的旧草稿解析器。上一候选只归一化了条款，因此本轮首先在税务事实
边界失败；付款阶段具有同一确定性缺口。

新增 RED 将条款、税务事实和付款阶段全部构造成已验证 DTO 实例，修复前精确返回：

```text
合同税务事实格式不正确，请刷新后重试
```

最小实现只在聚合内部把已由 ValidationPipe 校验的 `taxFacts` 和每个付款阶段浅拷贝
为 plain object，再进入既有严格解析器。原始 API 的 plain-object 边界、字段校验、
权限、金额、CAS、审计和事务规则均未放宽。

运行代码提交：
`0e40c305d3b95993d341705fe8cfb043101774a5`

## 6. 新候选门禁

- 精确 RED：1 失败，错误与生产完全一致；
- GREEN：聚合相关 100/100；
- API：251 套、4,751/4,751，另有 15 套/38 项条件跳过；
- shared-domain：149/149；
- Web：139 文件、1,248/1,248；
- 整仓 typecheck、lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API/Web build：通过；
- Prisma generate、validate：通过；
- 业务错误扫描：396 个生产 TypeScript 文件，55 个既有内部英文哨兵；
- 能力矩阵：184 个静态控制器路由、138 个 Web API 请求、395 个运行时路由，差异 0；
- P0 Chromium：2/2，另 2 项按真实环境变量条件跳过；
- 清单焦点：Chromium/WebKit 桌面及 960/640/375，8/8；
- 跨版本清单映射与主任确认：1/1；
- `git diff --check`：通过。

本修复不改变 Prisma Schema 或迁移树；生产本轮部署已再次证明同一 109 条迁移全部
存在且无待执行项。真实 Excel 回归包含在通过的 API 全量测试中。

`d5bd…` 的 push、部署、canary 和 token 授权已经消耗，不能延伸到包含本修复的新
候选。下一次 Release B 必须重新绑定新的 40 位 SHA，并重新授权三个 canary 与四账号
token 次数。transition、retention、其他业务写入和物理删除继续关闭。
