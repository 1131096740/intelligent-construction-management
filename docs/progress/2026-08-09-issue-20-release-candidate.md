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
