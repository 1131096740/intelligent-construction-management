# 合同工作台 Release B `ae7ddf4b` 回滚与条款 DTO 修复收据

日期：2026-07-30

授权候选：
`ae7ddf4b3e8aed0d74a845ca9af90cce7a5d19bc`

授权范围：候选分支 push、`main` fast-forward、生产 checkout、完整人工确认部署、
三个既定 canary，以及四账号各一枚新的 120 秒内存 access token和原烟测范围。

未授权且未执行：transition、retention、其他业务写入和任何物理删除。

## 1. Git 与生产前态

- 候选分支和 GitHub `main` 从 `10def0c7…` fast-forward 到获批 SHA；
- 生产 `/opt/jiangkong` 由 `10def0c7…` fast-forward 到获批 SHA，工作树洁净；
- 发布前生产为 `maintenance`、canary 0；
- API、Nginx、PostgreSQL active，回环与公网 health 均为 `status=ok`；
- 根权限只读前检 `checkedAt=2026-07-30T04:49:55.653Z`：
  - 目标版本 `722bb87e-700d-40d2-95b5-c82604cfb92c`；
  - `draft`、revision 12、正式编号空、首次提交时间空；
  - 审批 0、活跃租约 0、活跃保存回执 0、项目接管 0；
  - 既有 transition 审计 1；
  - 合同主管、财务主管、当前经办人和非 canary 合同专员哈希与授权一致。

## 2. 完整人工确认部署

生产切到 `release-b-maintenance` 并精确配置三个 canary 后，readiness 通过。部署器以：

```text
CANDIDATE_SHA_CONFIRMATION=ae7ddf4b3e8aed0d74a845ca9af90cce7a5d19bc
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
| 文件 | `jiangkong-20260730-125226.dump` |
| 大小 | 1,004,430 bytes |
| 权限 | `root:root 600` |
| SHA-256 | `1d2253a446dd80bd962f478aca03c35ec768faa56ee3a1447606f4ce02452f21` |
| checksum | OK |
| `pg_restore --list` | 1,658 行 |
| 异机收据 | `backupObjectKey`、`checksumObjectKey`、SHA、大小和上传时间字段存在且匹配 |

## 3. 一次性 token 与烟测

无 token 前置校验：

- `checkedAt=2026-07-30T04:53:04.496Z`；
- revision 12；
- 活跃租约/回执均为 0；
- 内容相同载荷 SHA-256：
  `26a41c169c539b140f2c9409ff703f932a3b25d201f3842242c3a2731a98f5db`。

唯一一次烟测于 `2026-07-30T04:53:15Z` 为四账号各签发一枚 120 秒内存 token。
未生成 refresh token、未调用登录接口、未输出或持久化 token。

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
  "message": "第 1 条合同条款格式不正确，请刷新后重试"
}
```

脱敏证据位于：

`/srv/jiangkong-release-b-evidence/ae7ddf4b3e8aed0d74a845ca9af90cce7a5d19bc/release1/smoke-failure.json`

脚本未重签、未重跑、未继续其他写操作。

## 4. 回滚与生产终态

发现失败后立即：

1. 将环境恢复为 `maintenance`；
2. 清空 canary；
3. 写入精确
   `ROLLBACK ae7ddf4b3e8aed0d74a845ca9af90cce7a5d19bc`；
4. 由部署器恢复旧 API/Web 运行时、重启 API、重载 Nginx并检查 health。

`2026-07-30T04:58:09.512Z` 的根权限终态收据证明：

- 四枚 token 已自然过期；
- 编辑租约已自然过期；
- revision 仍为 12；
- 活跃租约 0、活跃保存回执 0、失败幂等键回执 0；
- 审批 0、项目接管 0、正式编号空、首次提交时间空；
- transition 审计仍为 1；
- checkout 洁净并保持获批 SHA；
- API、Nginx、PostgreSQL active，内外 health 正常。

## 5. 根因与最小修复

全局 ValidationPipe 会把 `draft.clauses[]` 转成条款 DTO 实例。聚合保存随后把
`aggregateInput.draft` 交给旧草稿 `parseSaveInput`，其条款解析仍只接受
`Object.prototype` 或 null prototype 的 plain object，因此第一条已验证 DTO 在事务内
被拒绝。前一候选只修复了清单行的同类边界，未覆盖条款。

新增 RED 使用非 plain-object 的已验证条款实例调用真实聚合字段准备方法，修复前精确
返回“第 1 条合同条款格式不正确，请刷新后重试”。最小实现只在聚合内部把已验证条款
浅拷贝为 plain object，再进入既有严格解析；原始草稿 API、条款字段白名单、模板校验、
变更白名单、权限、CAS 和事务规则均未放宽。

运行代码提交：
`6e651c35e851471b63de5736f0fbc643c0ffad7b`

## 6. 本地发布门禁

- 聚合相关目标测试：124/124；
- API：251 套、4,751/4,751，另有 15 套/38 项条件跳过；
- shared-domain：149/149；
- Web：139 文件、1,248/1,248；
- 整仓 typecheck、lint：通过；
- Web E2E typecheck、`check:ui`：通过；
- API build、业务英文错误检查：通过；
- Prisma generate/validate：通过；
- 能力矩阵：184 个静态控制器路由、138 个 Web API 请求、395 个运行时路由，差异 0；
- P0 Chromium：2/2，另 2 项按真实环境变量条件跳过；
- 清单焦点：Chromium/WebKit 桌面及 960/640/375，8/8；
- 跨版本清单映射与主任确认：1/1；
- `git diff --check`：通过。

`ae7…` 的 push、部署、canary 和 token 授权已消耗，不能延伸到包含本修复的新 SHA。
下一次 Release B 必须重新绑定新的 40 位候选，并重新授权三个 canary 与四账号 token
次数。transition、retention、其他业务写入和物理删除继续关闭。
