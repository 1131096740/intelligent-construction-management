# 2026-08-09 Issue #20 本机发布候选与生产授权停线

## 结论

Issue #20 只准备可部署候选，不得把本记录解释为已上线或生产 Go。

本次先以 `5dcfde8fbefeb7cd4f8edca38e01cbb4456b006e` 进行发现性本机运行，确认现有门禁可执行；随后本文件形成独立的文档候选。文档提交会改变 Git SHA，因此所有最终本机收据必须在该提交后的精确 40 位 SHA 上重新生成。

生产只读预检和备份隔离恢复需要单独的生产访问及备份使用授权。该授权尚未提供；本次不连接生产数据库、不读取或修改生产业务数据、不访问生产 COS、不执行恢复、推送、合并或部署。

## 已完成的基线发现性运行

| 门 | 基线结论 | 边界 |
| --- | --- | --- |
| GitHub PR #42 CI | 静态/manifest、精确 SHA PostgreSQL 16、汇总三项均成功 | CI 关联 source SHA，不替代本候选的最终 SHA 收据 |
| release manifests | matched；452 routes、440 wrappers、462 bindings | 本地构建，无生产连接 |
| PostgreSQL 16 清单 | 123 migrations 至 M123；33 文件、63 测试、9 组、remaining 0 | 仅清单/本机 disposable runner；最终候选重新运行 |
| 隔离治理 UAT | 21/21 必选场景通过 | 临时 localhost PostgreSQL、API、写冻结 API 与本地文件存储 |
| 真实浏览器 | Chromium `1366x768`、WebKit `390x844` 均通过；400/403/409/503 均出现；浏览器错误、失败请求、测试失败均为 0 | 收据绑定基线 SHA，最终候选重新运行 |

## 已核验的最终本机固定点

`fc8d13324ef9a0e7b4512a23b56a0faf4cf086dc` 是本文件补充前已完成的最终本机候选。其完整收据如下；该 SHA 与本次文档补充后的候选不同，因此仅作为可审计的历史固定点，不能继承给新候选。

| 门 | `fc8d133` 收据 |
| --- | --- |
| 完整 Jest | 527 suites / 8,148 tests：8,075 passed、73 pending、0 failed；其中 API 为 331 suites / 6,043 tests（5,970 passed、73 pending、0 failed），shared-domain 为 15 suites / 158 tests，web-admin 为 181 files / 1,947 tests。 |
| 静态与发布门 | Prisma generate/validate、typecheck、lint、API build、Web production build、`check:ui`、business-errors self tests、go-live safety self-test、release manifests 全部通过；manifest 为 452 routes、440 wrappers、462 bindings。 |
| PostgreSQL 16 全动态门 | disposable runner 通过 123 migrations 至 M123（`20260808110000_contract_ended_application_purge`）、33 files / 63 tests、9/9 groups、remaining 0，耗时 315,907 ms；临时容器已清理。 |
| 隔离治理 UAT | 21/21 场景通过、failed cases 为空；只使用 localhost PostgreSQL、API、写冻结 API 与本地文件存储。 |
| Chromium | `1366x768`：200:72、201:15、400:1、403:7、409:1、503:1；browser errors、failed requests、test failures 均为 0。 |
| WebKit | `390x844`：200:64、201:13、400:1、403:7、409:1、503:1；browser errors、failed requests、test failures 均为 0。 |

本文件及 `PROGRESS.md` 的提交将改变候选 SHA。为避免 Git 提交自引用，新的精确 40 位 SHA 和同 SHA 的机器可读 JSON 收据仅在提交后生成，并由本文件下方列出的完整重跑门绑定；不得将本节的 `fc8d133` 收据误报为新 SHA 已通过。

## 最终本机候选门

提交本文件后，在该工作树干净且 SHA 精确匹配的前提下，重新执行：

1. Prisma generate/validate、目标 Jest、全量 typecheck、lint、test、API/Web build、business-errors、ops safety、UI governance 与 release manifests。
2. PostgreSQL 16 一次性动态门，覆盖 123 migrations、状态/权限/清理事务/恢复、版本化对象存储测试和 #19 只读预检测试。
3. 真实 Chromium 与 WebKit 隔离岗位链；保存两份浏览器 JSON 与治理 JSON，收据必须绑定同一候选 SHA。

## 未获授权的生产门

| 门 | 状态 | 原因与下一步 |
| --- | --- | --- |
| 生产只读预检 | BLOCKED | 需要用户明确授权生产只读访问；授权后才可执行脱敏预检并保留当时 SHA/数据库指纹收据。 |
| 备份隔离恢复 | BLOCKED | 需要用户明确授权选择和使用生产备份，在隔离 `jiangkong_restore_*` 目标恢复并应用候选迁移；不得自动触发。 |

在两条生产门完成前，候选结论为 **Local gates only / Production No-Go**。
