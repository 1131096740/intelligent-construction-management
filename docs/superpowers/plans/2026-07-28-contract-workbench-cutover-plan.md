# 合同工作台迁移、切换与旧能力清理实施计划

> **For Codex:** REQUIRED SUB-SKILL: 使用 executing-plans 逐任务实施并在每个门禁使用 verification-before-completion。本计划含生产敏感步骤，连接生产、迁移、清理、推送或部署仍需用户再次明确授权。

**目标：** 在不长期双写、不猜测历史事实的前提下，把现有草稿和历史接管切换到新聚合工作流，建立前后端能力矩阵，并在验证后删除检查点和旧写入口。

**核心架构：** 三次发布：A 为后端增量能力，B 为前端切换和旧写入口关闭，C 为旧代码/检查点物理清理。每次发布都能独立回滚到上一发布代码；数据库只做先增后删。

**依赖：** 前四份实施计划全部完成，合同部真实 Excel 回归已通过。

---

## Task 1：生成前后端能力矩阵

**Files:**

- Create: `scripts/inspect-contract-workbench-capabilities.mjs`
- Create: `scripts/inspect-contract-workbench-capabilities.test.mjs`
- Create: `docs/product/contract-workbench-capability-matrix.md`
- Modify: `package.json`

### Step 1：先写检查器 RED

检查器读取：

- Nest controller 的方法、HTTP verb 和 route。
- `apps/web-admin/src/api/contract-workbench.api.ts`、`core-flow-read.api.ts` 的请求函数。
- 页面和组件对 API 函数的静态引用。
- 明确登记的“后台任务/脚本专用”接口。

输出分类：

```text
matched
frontend_without_backend
backend_without_frontend
backend_internal_only
legacy_candidate
```

测试夹具要能识别：

- 页面按钮调用不存在 API wrapper。
- API wrapper 请求不存在 controller route。
- controller route 存在，但没有页面或脚本消费者。
- 动态参数 route 的等价匹配。

### Step 2：运行 RED

```bash
node --test scripts/inspect-contract-workbench-capabilities.test.mjs
```

### Step 3：实现并生成当前矩阵

```bash
node scripts/inspect-contract-workbench-capabilities.mjs --write docs/product/contract-workbench-capability-matrix.md
```

矩阵至少复核当前已知候选：

- 主体角色后端有更新/删除，当前页面入口不完整。
- 清单余量取消后端存在，工作台无常规入口。
- 授权 readiness、签署材料变更等治理能力是否只有后端。
- `listContractDrafts`、void/restore、单行 add/update/delete/reorder wrapper 是否仍有消费者。
- 旧 checkpoint 创建/列表是否仍有前端入口。
- 台账“删除草稿”是否调用了真正物理删除接口，还是旧逻辑放弃接口。

矩阵必须写“保留、补入口、转内部、删除”决策，不能只列 URL。

### Step 4：运行 GREEN

```bash
node --test scripts/inspect-contract-workbench-capabilities.test.mjs
node scripts/inspect-contract-workbench-capabilities.mjs --check docs/product/contract-workbench-capability-matrix.md
```

预期：检查器测试通过；matrix 与源码无漂移。

### Step 5：提交

```bash
git add scripts/inspect-contract-workbench-capabilities.mjs scripts/inspect-contract-workbench-capabilities.test.mjs docs/product/contract-workbench-capability-matrix.md package.json
git commit -m "docs: map contract workbench capabilities"
```

---

## Task 2：建立草稿迁移只读预检

**Files:**

- Create: `services/api/scripts/inspect-contract-draft-aggregate-readiness.cjs`
- Create: `services/api/src/database/contract-draft-aggregate-readiness-script.spec.ts`
- Modify: `services/api/package.json`

### Step 1：先写安全脚本 RED

静态测试断言：

- 默认只读，没有 `UPDATE`、`DELETE`、`INSERT`。
- 不接受不带数据库指纹的 apply。
- 不输出合同正文、COS objectKey、手机号、凭证内容。
- 所有金额以字符串输出。

预检按每个可编辑 `contractVersionId` 分类：

```json
{
  "contractVersionId": "cv-1",
  "status": "ready | manual_review | blocking",
  "facts": {
    "exactVersionReadable": true,
    "draftRevision": 8,
    "billCount": 2,
    "partyCount": 2,
    "attachmentCount": 1,
    "latestGeneratedRevision": 8,
    "hasCheckpointOnlyDifference": false,
    "hasPriorSubmissionEvidence": false,
    "formalCodeAllocatedWhileDraft": false,
    "activePurgeTask": false
  },
  "reasons": []
}
```

历史接管额外检查：

- 是否未激活草稿。
- 是否已有旧单确认。
- 合同侧和财务侧事实能否无猜测初始化。
- 是否包含旧“审批中未付/审批后未付”金额；这些不能迁移成历史实付。

全部已生效合同还要检查 `performanceStatus`。缺失时进入人工复核；不能仅凭名称、日期或“已生效”自动猜成履约中。存在 `settlementClosedAt` 和最终结算事实时可提出“已完成”候选，但仍由合同部主管确认。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-draft-aggregate-readiness-script.spec.ts
```

### Step 3：实现只读脚本

```bash
pnpm --filter @jiangkong/api inspect:contract-draft-aggregate
```

默认输出汇总和脱敏 fingerprint；`manual_review` 不能自动升级为 ready。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-draft-aggregate-readiness-script.spec.ts
```

### Step 5：提交

```bash
git add services/api/scripts/inspect-contract-draft-aggregate-readiness.cjs services/api/src/database/contract-draft-aggregate-readiness-script.spec.ts services/api/package.json
git commit -m "feat: inspect contract draft migration readiness"
```

---

## Task 3：建立受控迁移脚本

**Files:**

- Create: `services/api/prisma/transition-contract-draft-aggregate.cjs`
- Create: `services/api/prisma/run-contract-draft-aggregate-local.cjs`
- Create: `services/api/src/database/contract-draft-aggregate-transition.spec.ts`
- Modify: `services/api/package.json`

### Step 1：先写迁移安全 RED

脚本只允许处理预检 `ready` 清单，要求：

```text
--apply
--batch-id
--expected-database-fingerprint
--actor-user-id
--confirm TRANSITION_CONTRACT_DRAFT_AGGREGATE_<batch-id>
```

测试必须拒绝：

- 目标 fingerprint 不同。
- 预检后 revision 改变。
- 任何 `manual_review` 或 `blocking` 记录。
- 已提交或已生效版本。
- 把旧 pending/approved unpaid 金额写成实付。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/database/contract-draft-aggregate-transition.spec.ts
```

### Step 3：实现最小迁移

只做可证明转换：

- 对可编辑清单行按现有权威行金额回填 `taxExclusiveUnitPrice`。
- 对存在审批实例的合同版本，以最早审批实例 `createdAt` 可证明回填 `firstSubmittedAt`；无审批事实保持空。
- 新提交后生效的合同初始化 `not_started`；存量已生效合同只接受人工确认清单中的履约状态，不自动猜测。
- 为未激活且无旧确认的历史接管初始化合同侧/财务侧 facts revision。
- 旧历史实付只有在存在明确付款事实和凭证时才转换为逐笔记录；只有累计数而无逐笔事实时进入人工录入，不自动拆分。
- 不复制 `ContractDraftCheckpoint` 到主草稿。
- 草稿有正式编号但从未提交时，列为人工复核；不自动释放或重用编号。
- 每个转换写 batch audit receipt。

### Step 4：本地隔离数据库验证

```bash
pnpm --filter @jiangkong/api verify:contract-draft-aggregate:local
```

预期：

- fresh migrations 全部成功。
- 迁移前后合同、版本、清单、主体、付款条款和文件总数守恒。
- 只新增派生列和新 facts。
- 二次运行为零写幂等。

### Step 5：提交

```bash
git add services/api/prisma/transition-contract-draft-aggregate.cjs services/api/prisma/run-contract-draft-aggregate-local.cjs services/api/src/database/contract-draft-aggregate-transition.spec.ts services/api/package.json
git commit -m "feat: transition contract drafts to aggregate workflow"
```

---

## Task 4：实现存储保留策略

**Files:**

- Modify: `services/api/src/draft-retention/draft-retention.service.ts`
- Modify: `services/api/src/draft-retention/draft-retention.service.spec.ts`
- Create: `services/api/scripts/execute-contract-draft-retention.cjs`
- Create: `services/api/src/database/contract-draft-retention-script.spec.ts`
- Create: `scripts/ops/systemd/jiangkong-draft-retention.service`
- Create: `scripts/ops/systemd/jiangkong-draft-retention.timer`
- Modify: `scripts/ops/deploy-production-server.sh`

### Step 1：先写保留规则 RED

精确规则：

| 类别 | 保留 |
| --- | --- |
| 未绑定上传文件 | 24 小时 |
| 合同清单 Excel 导入预览和失败记录 | 7 天 |
| 结算/合同导入预览文件 | 7 天 |
| DOCX/PDF 渲染中间临时文件 | 成功绑定或失败收尾后立即清理 |
| 合同草稿预览 | 每个版本只保留最新一组成功 DOCX/PDF |
| 正式文件、审批冻结文件、归档、历史付款凭证 | 永久保留，禁止本任务删除 |
| 检查点 | Release C 删除整表，不再按 90 天保留 |

测试要求：

- 删除前重新扫描所有业务绑定和 replacement chain。
- 扫描被截断时零删除。
- COS 删除失败时 FileObject 不标记删除完成，可重试。
- 对象删除成功后才删除无引用 FileObject。
- 每批只记数量、字节数、类别和结果，不记 objectKey。

### Step 2：运行 RED

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/draft-retention/draft-retention.service.spec.ts src/database/contract-draft-retention-script.spec.ts
```

### Step 3：实现 preview/apply 双模式

执行脚本默认 preview；apply 要求数据库 fingerprint、batch id 和确认串。systemd timer 每日运行，但只有服务器环境显式设置：

```text
CONTRACT_DRAFT_RETENTION_EXECUTION_ENABLED=true
```

才执行 apply。首次生产启用仍需单独授权和 preview 验收。

### Step 4：运行 GREEN

```bash
pnpm --filter @jiangkong/api test -- --runInBand src/draft-retention/draft-retention.service.spec.ts src/database/contract-draft-retention-script.spec.ts
```

### Step 5：提交

```bash
git add services/api/src/draft-retention services/api/scripts/execute-contract-draft-retention.cjs services/api/src/database/contract-draft-retention-script.spec.ts scripts/ops/systemd scripts/ops/deploy-production-server.sh
git commit -m "feat: enforce contract draft file retention"
```

---

## Task 5：Release A——只发布增量后端

**代码范围：**

- 新 Prisma 表和 nullable 列。
- 新 `/contract-drafts/...` API。
- 新历史双侧 API。
- 新预检/迁移脚本。
- 旧前端和旧写 API 仍可工作。

### Step 1：本地发布候选门禁

执行总计划的全量测试、typecheck、lint、build、Prisma validate/generate。

### Step 2：生产前只读预检

仅在用户明确授权发布后：

1. 核对远端和待发布 SHA。
2. 执行自然备份/发布前备份门禁。
3. 运行只读草稿预检。
4. 保存脱敏报告和数据库 fingerprint。

### Step 3：部署 Release A

部署只执行增量迁移，不运行 transition apply，不启用 retention apply。

### Step 4：发布后只读验收

- API、Nginx、PostgreSQL healthy。
- 旧前端仍可保存草稿。
- 新精确 GET 对预检 ready 草稿返回相同 revision、金额、主体和清单计数。
- 新 API 未被未授权角色写入。

### Step 5：记录

在 `PROGRESS.md` 记录精确 SHA、迁移数、服务健康、只读计数和未执行事项。

---

## Task 6：迁移 ready 草稿并冻结旧写窗口

### Step 1：重新运行只读预检

不得复用 Release A 前的旧 fingerprint。对每条 revision 重新核对。

### Step 2：人工处置阻断项

- checkpoint 与权威草稿不同：合同经办人选择保留哪份，不自动合并。
- 草稿已有正式编号：合同部确认保留或作废，编号不回收重用。
- 旧历史累计实付无逐笔凭证：财务部重新录入逐笔事实。
- 旧 pending/approved unpaid：停止旧流程，部署后按新生效结算重新申请。

### Step 3：短维护窗口

仅冻结合同工作台和历史接管写入；合同详情、结算、付款和只读台账保持可用。

### Step 4：执行受控 transition

使用最新 batch、fingerprint 和精确确认串。完成后立即只读复核：

- ready 行数全部转换。
- 业务金额和文件计数守恒。
- 聚合 GET 可读。
- 旧正式合同不变化。

### Step 5：解除维护窗口

只有 Release B 前端已经准备好并可立即部署时才解除，避免旧客户端继续写旧语义。

---

## Task 7：Release B——切换前端并关闭旧写入口

**Files:**

- Modify: `services/api/src/contract-workbench/contract-workbench.controller.ts`
- Create: `services/api/src/contract-workbench/contract-workbench.controller.spec.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.spec.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`

### Step 1：先写旧客户端失败契约

Release B 后，旧的草稿 PATCH 和旧单确认路由返回：

```json
{
  "statusCode": 410,
  "code": "CONTRACT_WORKBENCH_CLIENT_UPGRADE_REQUIRED",
  "message": "合同工作台已升级，请刷新页面后继续办理"
}
```

不能把旧部分 payload 转写到新聚合事务，否则会覆盖新子域。

### Step 2：部署新前端和旧写关闭

新静态资源与后端同一发布候选，避免前后端契约错位。

### Step 3：发布后真实岗位烟测

最少覆盖：

1. 合同员打开现有草稿，版本 ID、已有信息、清单均正确。
2. 输入多个章节，等待自动保存，刷新后数据仍在。
3. 手动保存后资料成功，预览成功或独立失败。
4. 合同主管接管租约，旧页面转只读。
5. 财务人员录入历史实付；两侧主管分别确认。
6. 双确认后能进入结算工作台。

### Step 4：观察条件

至少完成一个真实草稿“打开—多章节编辑—自动保存—手动保存—刷新—提交审批”的完整闭环，再进入 Release C。不能只按时间等待替代业务闭环。

---

## Task 8：Release C——删除旧接口、检查点和无调用代码

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create only in Release C: `services/api/prisma/migrations/20260804100000_contract_workbench_legacy_cleanup/migration.sql`
- Modify: `services/api/src/contract-workbench/contract-workbench.controller.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.ts`
- Modify: `services/api/src/contract-workbench/contract-workbench.service.spec.ts`
- Modify: `services/api/src/draft-retention/draft-retention.service.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.ts`
- Modify: `apps/web-admin/src/api/contract-workbench.api.test.ts`
- Modify: `docs/product/contract-workbench-capability-matrix.md`

### Step 1：先用调用矩阵确定删除集合

必须重新运行：

```bash
node scripts/inspect-contract-workbench-capabilities.mjs --check docs/product/contract-workbench-capability-matrix.md
```

只有同时满足“无前端、无脚本、无回调注册、无生产兼容要求”的 route/function 才能删除。

候选：

- `GET /contract-workbench/:contractId` 最新版本读取。
- `PATCH /contract-workbench/:contractVersionId` 旧部分保存。
- checkpoint 创建、列表和 read model。
- 无调用的单行 add/update/delete/reorder wrapper。
- 旧历史接管一次性 confirm。
- 前端 `checkpoints`、横向业务 tabs、分散 dirty/save 状态。

### Step 2：先写负向测试

结构测试断言：

- 源码不再暴露旧 route。
- API client 不再导出旧 wrapper。
- Prisma schema 不再有 `ContractDraftCheckpoint`。
- `DraftRetentionService` 不再扫描 checkpoint。

### Step 3：删除旧代码和表

Release C 迁移：

```sql
DROP TABLE "ContractDraftCheckpoint";
```

执行前预检必须证明：

- 所有 editable draft 已通过新聚合 GET。
- 没有 checkpoint-only 人工待处理项。
- 最新备份可恢复该表。

### Step 4：运行全量门禁

除总计划命令外，再运行能力矩阵检查和 fresh PostgreSQL 全迁移。

### Step 5：提交

```bash
git add services/api apps/web-admin docs/product/contract-workbench-capability-matrix.md
git commit -m "refactor: remove legacy contract workbench writes"
```

---

## Task 9：最终生产验收

只有用户再次明确授权后执行：

1. 发布前备份及可恢复性证据。
2. Release C 精确 SHA 部署。
3. 数据库迁移状态和服务健康。
4. 真实 Excel 导入。
5. 草稿删除后 DB/COS 对象计数变化和最小审计收据。
6. 新草稿保存/刷新/提交。
7. 历史双侧确认、期初结算、逐笔历史付款。
8. 历史合同发起新结算，再发起付款申请。
9. 异常超付场景后端阻断。
10. retention preview；首次 apply 另行授权。

`PROGRESS.md` 最终记录：

- 精确发布 SHA 和迁移数。
- 测试、部署、生产只读/业务验收证据。
- 删除的旧能力清单。
- 保留的兼容能力及原因。
- 未解决问题和回滚点。

生产验收之前不得把计划状态写为“全部完成”。
