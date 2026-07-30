# 合同工作台 Release B 候选 7229 回滚收据

日期：2026-07-30
获批候选：`7229c061bc838c2eee3ad4e85897f9d2e5de3e5a`
目标版本：`722bb87e-700d-40d2-95b5-c82604cfb92c`
部署决定：`ROLLBACK 7229c061bc838c2eee3ad4e85897f9d2e5de3e5a`

## 1. 授权与执行结果

本轮获准推送候选分支、`main` fast-forward、更新生产 checkout、完整部署，并为既定
四账号分别签发一次新的 120 秒内存 access token，沿用已批准的最小 Release B
烟测范围。旧授权不得延伸到其他 SHA。

实际完成：

- 候选分支与 `main` 均推送并精确到 `7229c061…`；
- 生产 `/opt/jiangkong` checkout 精确到该 SHA，工作树洁净；
- 环境切到 `release-b-maintenance`，三个 canary 精确配置；
- 完整构建 API/Web、生成 Prisma Client；
- 109 个迁移均已完成，无待执行迁移；
- 新 API/Web 进入 1,800 秒人工确认窗口；
- 烟测失败后先恢复 `maintenance`、canary 0，再写入精确 `ROLLBACK`；
- 部署脚本恢复发布前 API/Web 运行时快照并通过 health。

生产 checkout 仍保留 `7229c061…`，但运行时已回退；这两项不能混称为“候选已发布”。

## 2. 部署过程中的工具故障

前两次完整部署尝试均发生在 token 签发和业务写入之前：

1. root Corepack 错误选择 pnpm 11.11.0，在 Node 20 上因 `node:sqlite` 失败；
2. 外层临时 pnpm 9 wrapper 完成构建，但迁移阶段嵌套 `sudo` 再次绕过 wrapper，
   仍选择 pnpm 11，部署脚本自动恢复旧运行时。

随后将服务器 Corepack 全局 pnpm 校正为项目锁定的 9.15.9。第三次部署完整通过。
前两次没有签发 token、获取租约或写入业务数据。

## 3. 第三次部署与备份证据

迁移前备份：

| 项目 | 结果 |
| --- | --- |
| 文件 | `jiangkong-20260730-114007.dump` |
| 大小 | 1,004,432 bytes |
| 权限 | `root:root 600` |
| SHA-256 | `102148b20fda941bf0e3b67bddd7922db2ff192d39dff1dfb17e87e9957b9d5f` |
| `sha256sum -c` | `OK` |
| `pg_restore --list` | 1,658 行 |
| 异机上传时间 | `2026-07-30T03:40:08Z` |
| 异机对象字段 | `backupObjectKey`、`checksumObjectKey` 均存在 |

第一次 checksum 命令不在备份目录执行，清单中的相对文件名无法打开；在实际备份
目录内重做后为 `OK`。该命令路径错误不是备份损坏。

## 4. 一次性 token 与烟测

无 token 前置检查先验证：

- checkout、环境和三个 canary 精确；
- 四账号不可逆哈希与授权一致；
- 目标为 draft、revision 12、正式编号空、未提交、审批 0；
- 活跃租约 0、活跃保存回执 0、项目接管 0；
- 指定 transition 审计恰好 1 条。

真实 GET 生成的聚合载荷最初因 `allowsEarlyPayment` 不是布尔值而被 DTO 拒绝。
诊断发生在 token 标记之前。按现有 Web 模型的 `?? false` 规则补齐后，DTO 通过，
载荷 SHA-256 固化为：

`faad08356db77412651e3adc10c5e11439d249d54bd2b8c4a5ab6655299f4728`

随后只运行一次 token 脚本：

- 四个账号各 1 枚 access token；
- 有效期 120 秒；
- 不生成 refresh token；
- 不调用登录接口；
- 不打印、不持久化 token；
- 脚本失败后不重签、不重跑。

已完成的负向/读取检查包括 owner 工作台 GET、非 canary 503、两条旧路由 410、
财务接管读取 200/空集合和财务写入 403。当前经办人随后成功取得租约，但聚合保存
返回 HTTP 400。脚本立即失败，没有生成 `smoke.json` 成功收据，也没有继续其他动作。

## 5. 回滚后数据守恒

`failure-check.json` 与自然过期后的 `failure-check-after-expiry.json` 证明：

| 事实 | 结果 |
| --- | --- |
| 合同版本状态 | `draft` |
| draft revision | `12` |
| 正式编号 | 空 |
| 审批实例 | `0` |
| 项目接管 | `0` |
| 失败保存技术回执 | 不存在 |
| 租约持有人 | 获批当前经办人 |
| 租约到期 | `2026-07-30T03:48:18.494Z` |
| 到期后 active | `false` |
| 环境 | `maintenance` |
| canary | `0` |

API、Nginx、PostgreSQL 均为 active；回环和公网
`https://jgzg.site/api/health` 均返回 `{"status":"ok","service":"jiangkong-api"}`。

## 6. 新根因与本地修复

候选 `338ecc3d…` 已让共享模型和 Web 保存链路透传 `allowsEarlyPayment`，但 API
读取 `PaymentTermsStage` 时使用显式 Prisma `select`，其中仍缺少该字段。因此：

```text
数据库 allowsEarlyPayment
  -> API Prisma select 丢失
  -> GET workbench 返回 undefined
  -> Web 无法原值回传
  -> 内容相同保存无法成立
```

新增 API 回归先得到 1 失败/62 通过，失败精确显示 select 缺字段。最小实现只在
`paymentTermsStage.findMany` 的 select 中加入 `allowsEarlyPayment: true`；目标 API
转为 63/63，既有 Web 聚合链路 65/65。

候选 `7229c061…` 不得重试。该修复必须形成新的精确 SHA，并重新取得 push、main、
生产 checkout、完整部署、canary 及新 token 次数授权。transition、retention、
其他业务写入和物理删除仍未授权。
