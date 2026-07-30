# 合同工作台 Release B 候选 10def 回滚收据

日期：2026-07-30

获批候选：`10def0c7b9dea16602b2575b24748ff94fd1da3d`

目标版本：`722bb87e-700d-40d2-95b5-c82604cfb92c`

部署决定：`ROLLBACK 10def0c7b9dea16602b2575b24748ff94fd1da3d`

## 1. 授权边界与执行结果

本轮获准：

- 推送精确候选、`main` fast-forward、更新生产 checkout 和完整部署；
- 配置合同部主管、财务部主管、当前经办合同专员三个 canary；
- 为三个 canary 和一个非 canary 合同专员各签发一次新的 120 秒内存 access token；
- 仅当前经办人取得自然过期租约并提交一次内容完全相同的聚合保存；
- 其余账号只执行读取、410、503 和权限负向；
- 成功保存只能新增一条七天技术回执，revision 必须保持 12。

transition、retention、其他业务写入和物理删除未授权。

实际执行：

- 候选分支和远端 `main` 均 fast-forward 到精确 SHA；
- 生产 `/opt/jiangkong` checkout 洁净且精确到该 SHA；
- 环境切到 `release-b-maintenance`，三个 canary 精确配置；
- API/Web 构建、Prisma Client 生成、Nginx 校验和完整部署通过；
- 109 个迁移均已应用，无待执行迁移；
- 新 API/Web 进入绑定同一 SHA 的人工确认窗口；
- 唯一一次烟测在聚合保存返回 HTTP 400 后立即停止；
- 先恢复 `maintenance`、清空 canary，再提交精确 `ROLLBACK`；
- 部署器恢复发布前 API/Web 运行时快照并通过健康检查。

生产 checkout 仍为 `10def0c7…`，但运行时文件已恢复到发布前快照；
`contract-workbench.service.js` 的运行时修改时间为
`2026-07-29 22:50:25.104903531 +0800`。checkout 与已确认运行时不能混称。

## 2. 部署备份与迁移证据

| 项目 | 结果 |
| --- | --- |
| 文件 | `jiangkong-20260730-120310.dump` |
| 大小 | 1,004,434 bytes |
| 权限 | `root:root 600` |
| SHA-256 | `5401cd3be7fa4d55b174b88cf5cc0c7225eee57f8ab96435a5d8e6e1e6bc983e` |
| `sha256sum -c` | `OK` |
| `pg_restore --list` | 1,658 行 |
| 异机上传时间 | `2026-07-30T04:03:11Z` |
| 异机回执 | `backupObjectKey`、`checksumObjectKey` 均存在 |
| Prisma | 109 个迁移，无待执行迁移 |

第一次人工复核命令把远端 shell 变量在本地展开成空字符串，导致 `stat` 和
`pg_restore` 对空路径失败；checksum 与异机回执已经通过。随后改用显式绝对路径，
上述大小、权限、checksum 和 1,658 行清单全部通过。该命令错误没有修改备份。

## 3. 无 token 前置检查

`2026-07-30T04:04:19.145Z` 前置检查通过：

- checkout、mode 和三个 canary 与授权一致；
- 四账号不可逆哈希与授权一致；
- 目标为 `draft`、revision 12、正式编号空、未提交、审批 0；
- 活跃租约 0、活跃保存回执 0、项目接管 0；
- transition 审计恰好 1 条；
- 真实工作台 GET 已返回布尔型 `allowsEarlyPayment`；
- 聚合载荷通过与 HTTP 相同的 ValidationPipe；
- 固化载荷 SHA-256 为
  `34a699e5e2f55ac0285274fe284a8dec5fdb540228eaae90c9db51a1a9327265`。

## 4. 一次性 token 与烟测

根权限证据
`/srv/jiangkong-release-b-evidence/10def0c7b9dea16602b2575b24748ff94fd1da3d/token-mint-once.json`
记录：

- `issuedAt=2026-07-30T04:04:34.000Z`；
- `expiresAt=2026-07-30T04:06:34.000Z`；
- `tokenCount=4`；
- 四账号分别签发一次；
- 不生成 refresh token、不调用登录接口、不输出或持久化 token。

烟测依次完成：

- 当前经办人工作台 GET 200；
- 非 canary 新写 503 `CONTRACT_CUTOVER_MAINTENANCE`；
- 合同主管旧 PATCH 410；
- 合同主管旧单确认 410；
- 财务主管接管读取 200 且为空；
- 财务主管接管写入 403；
- 当前经办人取得租约。

随后 `PUT /contract-drafts/:versionId` 返回 HTTP 400。脚本立即失败，没有生成
`smoke.json`，没有再次签发 token、重跑烟测或继续其他动作。

本次一次性脚本只记录了状态码，没有把 400 的安全响应体写入证据。这是烟测工具的
可观测性缺口；在取得新 token 授权前无法从已结束进程恢复响应体。

## 5. 回滚后数据守恒

`2026-07-30T04:06:59.580Z` 的根权限只读收据：

`/srv/jiangkong-release-b-evidence/10def0c7b9dea16602b2575b24748ff94fd1da3d/post-failure-rollback.json`

证明：

| 事实 | 结果 |
| --- | --- |
| token 窗口 | 已自然结束 |
| 合同版本状态 | `draft` |
| draft revision | `12` |
| 正式编号 | 空 |
| 首次提交时间 | 空 |
| 审批实例 | `0` |
| 活跃租约 | `0`，已自然过期 |
| 活跃保存回执 | `0` |
| 本次幂等键回执 | `0` |
| 项目接管 | `0` |
| transition 审计 | `1` |
| mode | `maintenance` |
| canary | `0` |

API、Nginx、PostgreSQL 均为 active；回环 `/health` 和公网
`https://jgzg.site/api/health` 均返回 `status=ok`。

## 6. 失败后的只读诊断

禁止重签 token 后，只使用已固化载荷、候选构建产物和只读数据库查询执行纯校验。
没有调用保存事务、没有获取真实租约，也没有 create/update/delete。

| 诊断 | 结果 |
| --- | --- |
| 11 行清单 DTO/领域解析 | 11/11 通过 |
| 解析后清单行等价比较 | 有效变化 0 |
| 清单 revision / pricingMode | `2` / `tax_inclusive` |
| 草稿模板校验 | 通过 |
| 草稿字段深比较 | 完全相同 |
| 条款快照深比较 | 完全相同 |
| 我方主体 | active、complete，当前版本存在 |
| 付款 basis / 合同类型 | `current_settlement` / `labor_subcontract`，通过 |
| 付款原文与阶段深比较 | 完全相同 |
| 合同主体深比较 | 完全相同 |
| 附件深比较与绑定权限 | 完全相同、通过 |
| 谈判文档引用 | 通过 |
| ValidationPipe 转换 | 转为普通 JSON 后深比较完全相同，字段差异 0 |

尝试以 monkeypatch 方式在生产保存路径外包数据库 `READ ONLY` 事务被风险策略拒绝；
该方案未执行，也未用其他方式绕过。

以上证据排除了当前可安全重放范围内的数据漂移、缺字段、清单重算、模板、主体、
付款、附件和谈判引用问题，但不能恢复已经丢失的 HTTP 400 响应体。因此本收据不把
未经证实的推测写成根因。

## 7. 下一授权门

本轮四枚 token 已全部失效，旧授权不能复用。候选没有被确认发布，生产继续保持
`maintenance`、canary 0 和发布前运行时。

下一步必须由用户明确决定是否允许对同一精确 SHA `10def0c7…`：

1. 再执行一次完整人工确认部署；
2. 恢复同一三个 canary；
3. 四账号各新增一次 120 秒内存 access token；
4. 保持原读取、410/503/403 和仅当前经办人一次内容相同保存范围；
5. 修改烟测证据，使任何非 200 响应先以根权限保存脱敏的
   `status/code/message/errors`，再失败回滚；
6. 成功后仍需等待租约自然过期和零业务变化终检，才允许 `CONFIRM` 与切换
   `release-b`、canary 0。

transition、retention、其他业务写入和任何物理删除继续未授权。
