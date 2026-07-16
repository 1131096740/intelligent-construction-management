# 合同税务事实与含税计价发布候选报告

日期：2026-07-17

状态：本地发布候选已完成代码、测试、浏览器和隔离迁移验收；未推送、未部署、未执行生产迁移、未写生产业务数据。

## 1. 发布结论

本轮已经把用户确认的合同票种、税率、含税单价、两位小数精度、历史补录复核和结算草稿门槛落成可验证的前后端事实。

运行时代码验收 SHA：

```text
92ba08f2259c626c68912c7f97ee60491334e928
```

分支：

```text
codex/contract-tax-facts-pricing
```

基线：

```text
origin/main = 48b5ec3fc91efd9f73cfa7a5eb6d4cde48e6c096
生产 Web/API = b857a4269aa907e0550470cece52c846bcbb7623
生产数据库 = 51 个完成迁移，0 个未完成迁移
候选数据库 = 52 个完成迁移，0 个未完成迁移
```

发布判断：

- 技术实现、全量自动化测试、浏览器验证和隔离迁移演练通过。
- 候选没有推送或部署，生产仍运行原 SHA 和 51 个迁移。
- 在用户批准最终文档提交形成的精确 40 位 SHA 前，不允许推送、部署或执行第 52 个迁移。
- 纯财务主管访问历史合同接管页面的读取边界仍需在发布前确认，详见第 9 节；未确认前整体保持 `No-Go`。

最终文档提交只会增加本报告和 `PROGRESS.md` 记录，不改变已经在
`92ba08f2...` 完成测试和恢复演练的运行时代码树。最终候选 SHA 以交付回复为准。

## 2. 实际实现范围

### 2.1 领域和数据库

- 新增合同版本级：
  - 发票类型；
  - 计税模式；
  - 默认税率；
  - 税务事实状态、来源、说明、证据文件和修订号；
  - 税务事实冻结时间。
- 合同清单行支持：
  - 可为空的历史数量、含税单价和税率；
  - 版本默认税率或行级例外税率来源；
  - 已确认/未确认价格事实；
  - `legacy` 与 `two_decimal` 精度策略；
  - 含税、不含税和税额恒等约束。
- 新增不可覆盖的 `ContractTaxFactRevision` 历史补录/更正账本。
- 新增不占用额度、不发起审批的 `SettlementDraft` 结算草稿。
- 结算和结算行新增票种、税务修订、含税单价、税率、不含税金额和税额快照。

### 2.2 后端

- 新合同提交审批前必须具备规范票种、有效税率和必要含税单价。
- 数量和含税单价的新录入值最多保留两位小数。
- 行金额由后端逐行四舍五入到分后汇总。
- 单一税率清单行继承版本税率；特殊多税率只允许例外行覆盖。
- 历史合同税务事实按“合同员录入 → 财务主管复核 → 合同部主管确认”生效。
- 历史未知事实保持 `null/未确认`，不推断为 `0` 或默认税率。
- 缺失税务或价格事实时允许保存结算草稿，但提交审批重新执行后端硬校验。
- 单项缺价只阻断包含该项目的结算。
- 保留既有结算 `manual_adjustment` 语义。
- 未修改合同、结算、付款的既有历史金额，也未修改付款额度、实付、入账和元分转换。

### 2.3 Web

- 合同工作台新增票种、计税模式、税率和含税金额录入。
- 清单新增行可直接录入含税单价，并按合同税率继承或例外覆盖。
- 历史接管展示税务缺口、修订状态、财务复核和合同部确认。
- 结算工作台支持保存/恢复同一草稿，并在事实补齐后自动重新请求后端核算。
- 结算台账展示“我的草稿”和精确税务缺口。
- 结算详情展示冻结的含税、不含税、税率和税额快照。
- 合同工作台与历史接管中的浏览器原生确认框已替换为现有 `SensitiveActionDialog`。

## 3. 迁移说明

新迁移：

```text
20260716160000_contract_tax_facts_and_settlement_drafts
```

迁移性质：

- 是数据库写迁移；
- 从 51 个迁移升到 52 个迁移；
- 新增列、表、索引、外键和检查约束；
- 迁移前既有清单行标记为 `legacy`；
- 只有结构化字段能同时证明票种与有效税率的非历史合同才允许兼容回填；
- 本次生产现状中没有可证明并安全回填的合同版本；
- 历史接管合同保持 `unconfirmed`；
- 不创建合同、结算、付款、审批、草稿或税务修订业务记录；
- 不改写既有合同金额、清单数量/价格/税额、结算金额或付款金额。

安全应用回滚点：

```text
d090e5c31bf85094b5661b67e67f60ade191a28f
```

该回滚点理解第 52 个迁移后的新增结构。生产一旦写入税务修订、结算草稿或带税务快照的新结算，不得回滚到不理解新结构的旧代码。

## 4. 生产只读审计

审计使用 `default_transaction_read_only=on`，未输出合同名称、相对方、人员、文件或连接凭据。

| 项目 | 结果 |
| --- | ---: |
| 合同版本 | 4 |
| 历史接管合同版本 | 1 |
| 系统合同版本 | 3 |
| 可证明票种和税率并安全回填 | 0 |
| 必须保持未确认 | 4 |
| 合同清单行 | 1 |
| 数量超过两位小数 | 0 |
| 含税单价超过两位小数 | 0 |
| 历史兼容清单行 | 1 |
| 已发布合同模板 | 4 |
| 数量精度超过两位的模板 | 4 |
| 含 `0%` 税率快捷项的模板 | 4 |

审计文档：

- `docs/progress/2026-07-16-contract-tax-facts-data-audit.md`

## 5. 隔离恢复与迁移演练

### 5.1 输入证据

最新自然异机备份收据：

```text
jiangkong-20260716-030001.dump.offsite.json
```

COS 对象：

```text
database-backups/daily/2026/07/16/jiangkong-20260716-030001.dump
database-backups/daily/2026/07/16/jiangkong-20260716-030001.dump.sha256
```

校验结果：

| 项目 | 结果 |
| --- | --- |
| dump 大小 | 254,832 字节 |
| dump SHA-256 | `ec94505159e7b2932f13ddf49a3e80e182913eb92263ea8d66c06ad40f294650` |
| checksum SHA-256 | `7e0645626c830820d038f346a05783e6346e528c939bd58289d1096d734340cb` |
| `pg_restore --list` | 440 项 |
| 候选 bundle SHA-256 | `1243a293e8f2e1d2086b1760e28255c1082baca14192041796acef517cc663f9` |

dump 和 checksum 均从 COS 重新下载，没有使用服务器本地 dump 冒充异机恢复输入。

### 5.2 演练过程

使用两个临时隔离库：

- 51 个迁移的恢复基线库；
- 在精确候选 `92ba08f2...` 上升级到 52 个迁移的候选库。

候选临时检出：

- SHA 精确匹配；
- 工作区洁净；
- pnpm `9.15.9`；
- Prisma `5.22.0`；
- 候选迁移目录 52 个。

最终结果：

```text
pre_migration_count=51
candidate_migration_count=52
completed_migration_count=52
Database schema is up to date!
restore_rehearsal_seconds=9
```

### 5.3 迁移前后事实比较

下列事实使用逐行稳定哈希和金额合计比较，迁移前后完全一致：

| 实体 | 记录数 | 金额合计（分） | 哈希比较 |
| --- | ---: | ---: | --- |
| `ContractVersion` | 4 | 3,000,000 | 一致 |
| `ContractBillRow` | 1 | 12,000 | 一致 |
| `Settlement` | 0 | 0 | 一致 |
| `SettlementLine` | 0 | 0 | 一致 |
| `PaymentRequest` | 0 | 0 | 一致 |
| `PaymentExecution` | 0 | 0 | 一致 |
| `ApprovalInstance` | 0 | - | 一致 |
| `ApprovalActionLog` | 0 | - | 一致 |

迁移后附加检查：

- `ContractTaxFactRevision = 0`；
- `SettlementDraft = 0`；
- 1 个历史接管合同版本仍为 `unconfirmed`；
- 该历史版本没有被推断出票种或默认税率；
- 1 个既有清单行全部标记为 `legacy`；
- 相关约束匹配 40 项，其中按迁移设计 38 项为未验证约束；
- 只读聚合审计结果与生产审计分组一致。

### 5.4 过程性排障

演练中出现三个只影响临时环境的工具问题：

1. 首次隔离库由 `postgres` 拥有，应用数据库角色无法创建恢复对象；临时库自动清理后改为由应用角色拥有。
2. root Corepack 默认选择 pnpm 11，与服务器 Node 20 不兼容；固定使用仓库既定 pnpm 9.15.9。
3. 临时检出首次未生成 Prisma Client；补充 `prisma generate` 后完整重跑。

三次失败均发生在 `jiangkong_restore_*` 隔离库或临时工具链中。最终完整重跑通过；每轮退出均验证隔离库被删除。

### 5.5 清理与生产复核

- 两个隔离数据库已删除；
- 临时候选检出已删除；
- COS 下载副本已删除；
- 候选 bundle 已删除；
- COS 备份对象未删除；
- 生产仍为 `b857a426...`；
- 生产数据库仍为 `51|0|0`；
- PostgreSQL、Nginx、API、Cron 均为 active；
- `https://jgzg.site/api/health` 返回正常。

## 6. 自动化测试

| 检查 | 结果 |
| --- | --- |
| shared-domain 全量 Vitest | 9 文件，87 项通过 |
| API 全量 Jest | 113 套，2,628 项通过 |
| API typecheck | 通过 |
| API lint | 通过；仅既有 TypeScript parser 版本提示 |
| API 中文业务错误检查 | 223 个生产 TS 文件通过 |
| API build | 通过 |
| Web 全量 Vitest | 89 文件，671 项通过 |
| Web typecheck | 通过 |
| Web E2E typecheck | 通过 |
| Web lint | 通过 |
| Web `check:ui` | 通过 |
| Web build | 通过；仅既有 chunk size 提示 |
| 全量 P0 E2E | 38 通过，2 条既有条件跳过，0 失败 |
| 候选截图定向 Playwright | 12/12 通过 |
| `git diff --check` | 通过 |

本会话没有暴露浏览器技能要求的 Node REPL JavaScript 工具，因此浏览器验收按既有治理规则回退到仓库 Playwright；没有绕过登录门禁或修改生产数据。

## 7. 截图

稳定 Mock/隔离数据共生成 65 张截图，覆盖：

```text
1512×982
1440×900
1280×800
1180×820
1024×768
900×768
```

截图根目录：

```text
/Users/leoyang/.codex/visualizations/2026/07/17/contract-tax-facts-release-candidate
```

代表性证据：

- 合同工作台税务与含税总价：
  `contract-workbench/contract-workbench-tax-pricing-1440x900.png`
- 合同清单新增行：
  `contract-workbench/contract-workbench-bill-row-1440x900.png`
- 历史接管待财务复核：
  `playwright-output/contract-takeover-responsi-ee9f9-ending-finance-tax-revision-chromium/contract-tax-review-pending-finance-1440x900.png`
- 结算税务事实阻断并保存草稿：
  `settlement-workbench/settlement-workbench-tax-blocked-1440x900.png`
- 事实补齐后恢复同一草稿：
  `settlement-workbench/settlement-workbench-tax-confirmed-1440x900.png`
- 结算冻结税务明细：
  `settlement-detail/settlement-detail-tax-lines-1440x900.png`

浏览器断言同时要求：

- 页面根无横向溢出；
- 专业宽表只在表格区域滚动；
- 不存在父子嵌套横向滚动条；
- 900px 至 1512px 的业务字段、状态和操作可达。

## 8. 受保护范围

以下目录相对 `origin/main` 差异为空：

```text
apps/web-admin/src/routes
services/api/src/payment
services/api/src/file
services/api/src/storage
services/api/src/approval
```

本轮未修改：

- 路由地址；
- 既有审批路线和冻结节点顺序；
- 付款额度、实付、入账或元分转换；
- 文件上传 API、类型、大小、私有桶和下载权限；
- 生产 CAM、COS、备份和告警配置；
- 生产业务数据。

运行时代码相对 `origin/main` 的审计范围为 131 个文件、18,979 行新增、1,085 行删除；主要集中在共享领域、合同/接管、结算、迁移、Web 表单和测试。

## 9. 未解决问题

### 9.1 财务主管读取历史接管页面

当前事实：

- `finance_director` 已获得 `contract.tax_fact.finance_review`；
- 财务复核写接口按该权限保护；
- 但 Web 路由 `/历史合同接管` 只允许 `contract_staff`、`contract_director`；
- 历史接管列表和详情读取 API 仍要求 `contract.create`；
- 当前 E2E 为验证复核动作，使用了 `contract_staff + finance_director` 双角色。

因此，纯财务主管账号不能独立进入该页面完成复核。

发布前必须二选一并由用户明确批准：

1. 公司实际把负责复核的财务主管同时配置为合同员岗位；或
2. 另开一个小范围变更，只增加财务主管对历史接管列表、详情和税务修订的只读访问，不授予合同创建、接管修改、资料上传或合同部确认权限。

本轮没有擅自修改受保护路由或扩大读取权限。

### 9.2 真实业务 UAT

自动化不能替代以下真实签认：

- 合同员：新合同四类计价场景；
- 财务主管：历史税务事实退回、复核；
- 合同部主管：最终确认；
- 合同员：缺价结算草稿、事实补齐后继续提交；
- 正式合同模板和公司实际税率；
- 普通岗位权限矩阵。

## 10. 发布与回滚

### 发布前

1. 解决或确认第 9.1 节财务读取边界。
2. 用户明确批准最终 40 位候选 SHA。
3. 推送后要求 CI 在该 SHA 全绿。
4. 生产迁移前重新生成本地 dump、checksum 和有效异机收据。
5. 核对生产仍为 51 个迁移，再执行第 52 个迁移。

### 安全回滚

- 新功能尚未产生写入：保留兼容新增结构，应用回滚到 `d090e5c3...`。
- 已产生税务修订、结算草稿或新结算快照：不得回滚到不理解新结构的旧生产代码。
- 不在生产手写 down migration。
- 如必须完全撤销数据库，停止写入并按已验证备份恢复，另行审批 RPO/RTO 和数据差异。

## 11. 停止条件

当前已停止在本地候选阶段。未经用户后续明确批准，不执行：

- 推送 `main`；
- 部署 Web/API；
- 第 52 个生产迁移；
- 生产合同、结算、付款或文件写入。
