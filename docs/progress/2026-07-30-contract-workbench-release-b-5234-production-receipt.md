# 合同工作台 Release B `5234fd37` 生产发布收据

日期：2026-07-30

获批精确候选：
`5234fd37bc5c320922f73323af77b20317fcf5f7`

授权范围：

- 候选分支 push、`main` fast-forward、生产 checkout 和完整人工确认部署；
- 合同部主管、财务部主管、目标草稿当前经办人三个 canary；
- 合同部主管、财务部主管、当前经办人和另一名合同专员四账号各一枚新的
  120 秒内存 access token；
- 当前经办人仅执行一次内容相同聚合保存，revision 必须保持 13，
  `effectiveChangedSections` 必须为空；
- 允许新增一条七天技术保存回执和自然过期编辑租约。

未授权且未执行：transition、retention apply、烟测范围外业务写入、物理删除或
不可逆清理。

## 1. 精确 Git 与生产基线

发布前核对结果：

- 隔离 worktree 分支 `codex/whole-site-five-packages` 为获批 SHA，工作树洁净；
- 远端候选分支、远端 `main`、本地 `main` 和生产 `/opt/jiangkong` 均从
  `6c244a1bf019f2a046660a9dbf331a2d32e2d623` 严格 fast-forward 到获批 SHA；
- 发布后四者继续精确为获批 SHA，两个本地 worktree 和生产工作树均洁净；
- 生产发布前为 `maintenance`、canary 0，API、Nginx、PostgreSQL active，
  回环与公网 health 均正常；
- retention 未启用，精确部署决定文件不存在。

根权限只读前检：

| 项目 | 结果 |
| --- | --- |
| `checkedAt` | `2026-07-30T07:10:15.542Z` |
| 目标版本 | `722bb87e-700d-40d2-95b5-c82604cfb92c` |
| 状态 / revision | `draft` / 13 |
| 正式编号 / 首次提交 | 空 / 空 |
| 审批 / 活跃租约 / 项目接管 | 0 / 0 / 0 |
| 活跃技术保存回执 | 1 |
| transition 审计 | 批次 `contract-draft-aggregate-20260730-r12` 恰好 1 |
| `workbenchReferences` | 两个选择均为 null，引用生成文档数组为空 |

用户接受的既有回执精确为 `expectedRevision=12`、`resultRevision=13`、
`saveKind=manual`，保存人哈希为当前经办人 `7d38fac2…`，到期时间
`2026-08-06T06:45:32.886Z`，唯一有效变化区段为
`negotiation_documents`。最新保存审计精确记录 revision 12→13 和同一变化区段。

四账号哈希与授权一致：

- 合同部主管：`8caaa4fce00371b273b24af8ef18b16c608aac95e0c14425395d3718b5758d7d`
- 财务部主管：`800f95268a08bd710b5e336fdc22171f48df32f9a2b2abb28aa8737579ab7070`
- 当前经办人：`7d38fac2e3afcf8bc366838d8328558ded367700b532827f2be9f9d8d0ebe7fd`
- 非 canary 合同专员：
  `29cb3a25476b8d4c5b94584c880e0803e561834866e67e143fcd7172b0e227a1`

## 2. 完整人工确认部署

先将生产切到 `release-b-maintenance` 并写入精确三个 canary。
`verify-production-readiness.cjs` 在 `CHECK_DATABASE_STATE=true` 下全项通过，
包括 seed 用户停用、seed refresh token 撤销、私有存储配置、生产密钥形态、字体、
cutover mode 和三个 canary。API 重启后内外 health 通过。

部署器使用：

```text
CANDIDATE_SHA_CONFIRMATION=5234fd37bc5c320922f73323af77b20317fcf5f7
DEPLOY_SCOPE=full
DEPLOY_CONFIRMATION_MODE=manual
DEPLOY_CONFIRMATION_TIMEOUT_SECONDS=1800
```

完成：

- Prisma Client generate；
- shared-domain、API 和 Web 生产构建；
- Nginx 配置校验；
- 109 个迁移核对，无待执行迁移；
- API/Web 运行时切换及健康检查；
- 进入精确人工决定窗口。

本次部署备份：

| 项目 | 结果 |
| --- | --- |
| 文件 | `jiangkong-20260730-151236.dump` |
| 大小 | 1,005,167 bytes |
| 权限 | `root:root 600` |
| SHA-256 | `da678b33dffb7853ba7cf2e6cf6b483ebe284bee7dc69123ceb179345e27a68b` |
| checksum | 从备份实际目录执行，OK |
| `pg_restore --list` | 1,658 行 |
| 异机收据 | `backupObjectKey`、`checksumObjectKey` 均存在并指向同名文件，`backupSha256` 匹配 |
| 异机上传时间 | `2026-07-30T07:12:37Z` |

本轮没有新增 Schema 或迁移。获批 SHA 与已完成 Release A 隔离恢复的
`3ad17a85e8c67003551cec2fb1a9fe44afd0d243` 之间，
`services/api/prisma/schema.prisma` 和 `services/api/prisma/migrations` 的文件差异为
0；因此 Release A 的生产备份隔离恢复继续证明当前数据库结构/迁移树可恢复。本次新
备份另完成 checksum、异机收据和 `pg_restore --list`，但没有把该新备份再次恢复到
新的临时库，不能把完整性检查表述成该文件的新隔离恢复。

## 3. 唯一一次四账号 token 烟测

无 token 前检：

- `checkedAt=2026-07-30T07:12:58.495Z`；
- revision 13；
- 活跃租约 0、活跃回执 1、审批 0、接管 0、transition 审计 1；
- 内容相同载荷 SHA-256：
  `cf5e8a25168aadc171c7bef61b85a02e23bd4922c5eb12b508b922b9a26716cb`；
- 四账号哈希与授权一致。

四枚 access token 仅于 `2026-07-30T07:13:03Z` 在单进程内存中签发一次，
统一于 `2026-07-30T07:15:03Z` 到期。未生成 refresh token、未调用登录接口、
未输出或持久化 token。证据只保存签发窗口、数量 4 和账号哈希。

烟测结果：

| 行为 | 结果 |
| --- | --- |
| 当前经办人聚合工作台读取 | 200 |
| 非 canary 新写 | 503 `CONTRACT_CUTOVER_MAINTENANCE` |
| 旧工作台 PATCH | 410 `CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED` |
| 旧单确认 | 410 `CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED` |
| 财务主管接管列表读取 | 200，空列表 |
| 财务主管接管写入负向 | 403 |
| 编辑租约 | 仅当前经办人取得 |
| 内容相同聚合保存 | 200，revision 13→13 |
| `effectiveChangedSections` | `[]` |
| 业务快照 | 保存前后 SHA-256 均为 `0be9bfd5c72c4153ca78bb0ead6ea41b3fb7009442ddfff25b4de132bd9392d8` |
| 技术回执 | 仅新增 1 条，`expectedRevision=13`、`resultRevision=13` |
| 新回执到期 | `2026-08-06T07:13:03.887Z` |
| 编辑租约到期 | `2026-07-30T07:15:03.837Z` |

守恒快照覆盖合同 1、版本 1、清单 1、清单行 11、主体 1、付款条款版本 1、
付款阶段 1、附件 0、审批 0、审计 12、接管 0。技术回执和租约是授权的技术事实，
不纳入业务快照哈希。

等待 token 和租约自然过期后，最终只读检查于
`2026-07-30T07:15:32.097Z` 通过：

- revision 13；
- 活跃租约 0；
- 活跃技术回执 2（既有 12→13 + 本次 13→13）；
- transition 审计 1；
- 业务快照哈希保持不变。

首次调用最终检查时，运维脚本误用不存在的回执 `id` 字段，Prisma 在纯读取参数
校验处失败，未发出数据库请求。脚本随后只把定位方式改为已保存的唯一
`idempotencyKey`，未重签 token、未重复烟测、未重复保存；修正后的最终检查通过。
执行实际 token 烟测的脚本 SHA-256 为
`ebf9a13c62c3d8ea17883d17f79b83ee7f2a682bb59ac467a37ba5ec5a2647fc`，
只读最终检查脚本修正版 SHA-256 为
`69d4c6356dc2dff307de81b0e97cd8573ff0efbf576a8d40d1b6be7238733797`。

## 4. 确认、开放与生产终态

全部烟测和自然过期检查通过后，写入精确：

```text
CONFIRM 5234fd37bc5c320922f73323af77b20317fcf5f7
```

部署器确认新运行时并结束回退窗口；只安装 retention 单元，未启用或启动 timer。
随后环境切换为 `release-b`、canary 清空，重新运行含数据库状态的 readiness，
重启 API 并核对内外 health。

生产终态：

| 项目 | 结果 |
| --- | --- |
| checkout | 精确 SHA，clean |
| 远端候选 / `main` | 精确 SHA |
| cutover | `release-b`，canary 0 |
| API / Nginx / PostgreSQL | active |
| 回环 / 公网 health | `status=ok` |
| Web 入口 | `assets/index-ND8lT_7j.js`、`assets/index-riGfU8H0.css` |
| Prisma | 109 个迁移，schema up to date |
| retention timer | `disabled` / `inactive` |
| 决定文件 / 回滚目录 | 0 / 0 |
| API / Nginx warning 及以上日志 | 本次部署窗口后均为 0 行 |
| 目标版本 | draft / revision 13 |
| 正式编号 / 首次提交 / 审批 / 接管 | 空 / 空 / 0 / 0 |
| 活跃租约 / 活跃回执 | 0 / 2 |
| 空工作台引用 | 保持两项 null、引用文档数组为空 |
| 保存审计总数 | 9，内容相同保存未新增业务保存审计 |
| transition 审计 | 1 |

生产根权限证据目录：

`/srv/jiangkong-release-b-evidence/5234fd37bc5c320922f73323af77b20317fcf5f7/release1/`

其中 `preflight.json`、`pretoken.json`、`token-mint-once.json`、`smoke.json` 和
`final-check.json` 均为 root `600`。`pretoken.json` 含受保护的载荷和账号 ID，
只留在服务器根权限目录；证据不含 access token 或任何生产密钥。

## 5. 完成结论与后续边界

精确候选 `5234fd37bc5c320922f73323af77b20317fcf5f7` 已完成获批的 Release B：

- push、`main` fast-forward、生产 checkout 和完整部署通过；
- 三 canary 和四账号唯一一次 token 烟测通过；
- 内容相同保存保持 revision 13，空有效变化区段和业务快照守恒；
- 新技术回执与自然过期租约符合授权；
- 人工 `CONFIRM`、`release-b` 开放、健康、迁移、备份和日志收口通过。

未执行 transition、retention apply、其他生产业务写入或物理删除。旧接口后续观察、
真实合同持续使用、retention 启用、C1 旧代码删除及 C2/M3 物理清理仍使用各自独立
授权门，不因本次 Release B 自动获准。

本收据和 `PROGRESS.md` 更新发生在生产部署完成后；其 docs-only 收口提交不是本次
获批生产 SHA，不会在没有新授权时推送、合并或部署。
