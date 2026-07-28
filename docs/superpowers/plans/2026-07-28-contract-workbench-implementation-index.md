# 合同工作台与历史合同接管改造实施总计划

> **For Codex:** REQUIRED SUB-SKILL: 使用 executing-plans 逐任务实施；每个行为任务使用 test-driven-development，任何完成声明前使用 verification-before-completion。

**目标：** 按已确认规格重构合同草稿工作台、清单计税和历史合同接管，同时保持现有正式合同、结算、付款和审计链不被旁路。

**规格来源：** `docs/superpowers/specs/2026-07-28-contract-workbench-and-historical-takeover-redesign.md`

**实施原则：**

- 精确以 `contractVersionId` 读取和修改草稿，不再按合同查“最新可编辑版本”。
- 顶部唯一“保存草稿”是资料保存入口；自动保存与手动保存共用同一个后端聚合事务。
- 资料事务成功与文档预览成功分开反馈，文档失败不能回滚已保存资料。
- 正式合同编号只在“资料冻结并成功创建审批实例”的事务中分配。
- 清单金额只以逐行权威金额汇总，不以页面展示的两位不含税单价反算。
- 历史接管由合同部、财务部独立保存和独立确认；双主管确认后一次性激活。
- 新旧接口只做短期分阶段替换，不做长期双写。
- 未取得合同部真实 Excel 前，不允许进入生产发布阶段。

## 五个实施包

| 顺序 | 实施包 | 主要产物 | 前置条件 |
| --- | --- | --- | --- |
| 1 | [草稿聚合持久化与生命周期](2026-07-28-contract-draft-aggregate-persistence-plan.md) | 精确版本 API、全局事务保存、编辑租约、提交时编号、纯净草稿物理删除 | 无 |
| 2 | [清单、税率与金额精度](2026-07-28-contract-bill-tax-money-plan.md) | 权威行金额公式、6 位不含税单价、Excel 税率归一化、真实 Excel 回归门禁 | 实施包 1 的聚合 DTO 边界 |
| 3 | [合同工作台前端](2026-07-28-contract-workbench-frontend-plan.md) | 左文档右资料、竖向章节、问题定位、唯一保存入口、移动端切换 | 实施包 1、2 的稳定 API |
| 4 | [历史合同双部门接管](2026-07-28-historical-contract-takeover-plan.md) | 双侧修订与确认、逐笔实付及凭证、期初结算、预付/异常超付处理 | 实施包 2 的金额工具 |
| 5 | [迁移、切换与旧能力清理](2026-07-28-contract-workbench-cutover-plan.md) | 草稿迁移预检、能力矩阵、分阶段切换、检查点和旧接口清理、发布门禁 | 实施包 1–4 |

## 推荐提交序列

每个提交必须保持可构建；不要把整个改造压成一个提交。

1. `test: lock contract draft aggregate invariants`
2. `feat: add version-scoped contract draft aggregate api`
3. `feat: add contract draft edit lease and purge lifecycle`
4. `fix: allocate contract code during approval submission`
5. `test: lock contract bill tax and precision rules`
6. `fix: normalize contract bill tax imports`
7. `fix: preserve six-decimal net unit prices`
8. `feat: rebuild contract workbench save orchestration`
9. `feat: add vertical contract workbench navigation`
10. `test: lock historical takeover dual confirmation`
11. `feat: split historical takeover department facts`
12. `feat: materialize historical payments and balances`
13. `chore: migrate contract drafts to aggregate workflow`
14. `refactor: remove legacy contract workbench writes`
15. `docs: record contract workbench release evidence`

## 跨实施包不变量

### 草稿一致性

- 一个保存请求只有一个 `expectedRevision`，且整个请求只递增一次 `draftRevision`。
- 任一子域校验失败，字段、主体、清单、税务、付款条款、条款和附件关联均不得部分落库。
- 自动保存期间的新输入不能被旧响应覆盖。
- 编辑租约失效后的旧页面只能转为只读，不能继续写入。
- 页面内导航必须先完成全局保存；保存失败时阻止离开。

### 金额一致性

含税计价行：

```text
含税行总价 = roundCent(数量 × 含税单价)
不含税行总价 = roundCent(含税行总价 ÷ (1 + 税率))
税额 = 含税行总价 - 不含税行总价
不含税单价 = round6(不含税行总价 ÷ 数量)
```

- 合同和清单总额只汇总行总价。
- 页面展示两位不含税单价仅用于阅读，不能参与保存或总额计算。
- 单一税率合同的模板税率来自合同版本，不允许行级覆盖。
- 多税率合同才允许行级例外税率。

### 历史接管一致性

- 合同侧与财务侧各自有修订号和当前确认修订号。
- 任一侧修改后只使本侧确认失效，另一侧确认保持不变。
- 激活前允许带原因撤回本侧确认；激活后只能走更正记录。
- 每笔历史实付至少一份凭证；一份凭证只能属于一笔历史实付。
- 双确认激活事务同时生成生效合同版本、唯一历史期初结算和历史实付记录。
- 历史未付差额只是后续付款上限，不自动生成待付款申请。
- 异常超付未解除前，后续新付款必须由后端失败关闭。

## 集成门禁

完成每个实施包后执行其定向测试；五个实施包合流后至少执行：

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test -- --runInBand
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin typecheck:e2e
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
git diff --check
```

预期：全部退出码为 `0`；Jest、Vitest 无失败；Prisma schema 有效；UI 规则无新增违规。

## 生产发布硬门禁

在以下条件全部满足前，状态只能写“本地实现/验证完成”，不能写“发布完成”：

1. 合同部提供造成约 5 元差异的原始 Excel，已脱敏保留为测试夹具或记录 SHA-256 后受控保存。
2. 原始 Excel 在旧实现测试中能复现税率或金额差异，在新实现中通过并输出逐行对账。
3. 草稿迁移只读预检无阻断项；所有阻断项均人工处置，不自动猜测。
4. 生产备份、迁移、部署、回滚和只读验收按项目发布手册执行。
5. 普通合同员、合同部主管、财务人员、财务主管至少各完成对应权限的试运行。
6. 生产部署需用户另行明确授权；本实施计划不构成生产发布授权。

## 完成定义

只有满足以下条件，整个改造才可在 `PROGRESS.md` 标为完成：

- 五个实施包的代码、迁移、测试和文档均已合入同一发布候选。
- 旧工作台写接口、检查点和分散保存入口已按清理计划移除。
- 能力矩阵中不存在“前端按钮无后端实现”或“P0 后端能力无前端入口”。
- 真实 Excel 回归通过。
- 生产发布和发布后只读验证完成，且无生产业务数据异常。
