# 建工智管全项目受控重构实施总计划（五包）

> **执行要求：** 按任务顺序实施；每个行为任务先锁定失败用例，任何完成声明前运行计划列出的全部验证命令。

**目标：** 按已确认规格重构合同草稿、清单计税、模板签名、合同付款、零星
支付、项目资金、挂靠业务持续接管和历史合同接管；完成原生小程序及旧接口
退役，同时保持正式合同、审批、文件和不可变财务事实不被旁路。

**规格来源：** `docs/superpowers/specs/2026-07-28-contract-workbench-and-historical-takeover-redesign.md`

**实施原则：**

- 精确以 `contractVersionId` 读取和修改草稿，不再按合同查“最新可编辑版本”。
- 顶部唯一“保存草稿”是资料保存入口；自动保存与手动保存共用同一个后端聚合事务。
- 资料事务成功与文档预览成功分开反馈，文档失败不能回滚已保存资料。
- 正式合同编号只在“资料冻结并成功创建审批实例”的事务中分配。
- 清单金额只以逐行权威金额汇总，不以页面展示的两位不含税单价反算。
- 历史接管由合同部、财务部独立保存和独立确认；财务确认必须记录所见合同
  修订并绑定 `financeBasisRevision`，双主管基于同一财务口径确认后才一次性
  激活。
- 历史实付保持为已发生事实，不补造普通付款审批；预付款抵扣和更正使用
  不可变流水。
- 新旧接口只做短期分阶段替换，不做长期双写。
- 未取得合同部真实 Excel 前，不允许进入生产发布阶段。
- 我方签约主体与实际付款主体必须一致；挂靠企业签约业务只接管，不补造我方
  审批。
- 经办人只选择业务场景；合同类型、资料规则和默认文件版式由系统确定。
- 项目可用资金在实际支付事务中硬性复核，垫资额度只在实付凭证落库后占用。
- 所有审批动作冻结审批人预先登记的手写签名版本。
- 原生小程序不再建设，移动端统一为响应式 Web。

## 实施前门禁（不计入五个实施包）

开始实施包 1 前先完成只读基线，不等到前四包完成后才发现数据冲突：

1. 生成当前前后端能力矩阵并登记保留、补入口、转内部、退出决定。
2. 盘点现有草稿、检查点、历史接管、正式编号、附件和统一文件绑定目录。
3. 取得合同部真实 Excel；若暂时无法取得，至少明确实施包 2 的 Excel adapter
   只能处于“本地候选”，不能定稿或进入发布候选。
4. 输出脱敏报告摘要、数据库指纹和报告 SHA-256；本阶段只读，不迁移、不
   清理、不连接 COS 删除对象。
5. 用现有典型清单和 100/500/1000 行夹具预先登记请求体大小、保存事务 P95、
   锁持有时间和审计增长预算；阈值必须在实现结果出现前确定，不能事后放宽
   以掩盖全快照协议的性能问题。
6. 盘点每个项目的唯一挂靠企业、业主主合同、上游结算、业主向挂靠企业付款、
   挂靠企业向我方拨款、挂靠扣款及现有收款类型，只读输出无法确定映射的
   人工清单。
7. 生成全部前端 API 封装、页面动作和后端路由 manifest；登记本规格第 28.2
   节退出集合的静态消费者和生产调用证据。
8. 盘点六类合同、旧 `generic_contract`、金额性质、付款来源和无固定总价
   合同；在分类报告确认前不得批量改写。
9. 盘点 `apps/miniprogram`、`/auth/wx-login`、`wxOpenid` 和共享移动/文件/
   签名依赖，证明小程序专属边界。

## 五个实施包

| 顺序 | 实施包 | 主要产物 | 前置条件 |
| --- | --- | --- | --- |
| 1 | [核心契约、草稿聚合与模板治理](2026-07-28-contract-draft-aggregate-persistence-plan.md) | 精确版本 API、全局事务保存、编辑租约、六类合同、金额性质、业务场景、资料规则/版式/条款治理 | 实施前只读基线 |
| 2 | [清单金额与统一资金规则](2026-07-28-contract-bill-tax-money-plan.md) | 权威金额、Excel 税率、结算/直接付款分类、零星材料/费用、项目资金与垫资额度 | 实施包 1 的领域契约 |
| 3 | [响应式工作台、签名与页面入口](2026-07-28-contract-workbench-frontend-plan.md) | 合同工作台、自动模板匹配、手写签名、零星支付、垫资、上游与挂靠页面、移动 Web | 实施包 1、2 的稳定 API |
| 4 | [历史合同与挂靠业务持续接管](2026-07-28-historical-contract-takeover-plan.md) | 历史双部门接管、唯一挂靠企业、业主主合同/结算/付款、挂靠拨款/扣款、外部合同结算付款账本 | 实施包 1、2 的共享不变量 |
| 5 | [迁移、能力收口与旧运行时清理](2026-07-28-contract-workbench-cutover-plan.md) | 数据预检、能力矩阵、分阶段切换、精确旧接口退出、小程序退役、发布门禁 | 实施包 1–4 |

## 推荐提交序列

以下是跨包关键里程碑顺序，不替代各实施包 Task 中更细的提交步骤。每个提交
必须保持可构建；不要把整个改造压成一个提交。

1. `test: lock contract draft aggregate invariants`
2. `feat: add version-scoped contract draft aggregate api`
3. `feat: add contract draft edit lease lifecycle`
4. `feat: save contract draft aggregate atomically`
5. `fix: allocate contract code during approval submission`
6. `feat: separate draft save from preview generation`
7. `test: lock contract bill tax and precision rules`
8. `fix: normalize contract bill tax imports`
9. `fix: preserve six-decimal net unit prices`
10. `feat: rebuild contract workbench save orchestration`
11. `feat: add contract draft recovery and vertical navigation`
12. `test: lock historical takeover dual confirmation`
13. `feat: split historical takeover department facts`
14. `feat: activate historical payment facts`
15. `feat: add historical balance ledgers and corrections`
16. `chore: migrate contract drafts to aggregate workflow`
17. `chore: switch contract workbench to aggregate writes`
18. `refactor: remove legacy contract workbench writes`
19. `refactor: remove legacy contract checkpoints`（仅 Release C2 获得独立授权后）
20. `feat: govern contract scenarios templates and standard clauses`
21. `feat: enforce contract settlement and direct payment types`
22. `feat: unify project funding and financing quota allocation`
23. `feat: split spot material and incidental expense payment`
24. `feat: freeze handwritten approval signatures`
25. `feat: add affiliate upstream and downstream takeover ledgers`
26. `refactor: remove classified legacy api surfaces`
27. `refactor: retire native wechat mini program runtime`
28. `docs: record whole-site release evidence`

## 跨实施包不变量

### 草稿一致性

- 一个保存请求只有一个 `expectedRevision`，且整个请求只递增一次 `draftRevision`。
- 任一子域校验失败，字段、主体、清单、税务、付款条款、条款和附件关联均不得部分落库。
- 自动保存期间的新输入不能被旧响应覆盖。
- 客户端 `changedSections` 只作提示，服务端根据锁定后的完整快照自行确认实际
  差异；漏报分区不能造成漏写。
- 编辑租约失效后的旧页面只能转为只读，不能继续写入。
- 页面内导航必须先完成全局保存；保存失败时阻止离开。
- 保存幂等记录有 7 天 TTL；后台自动保存不逐次写永久 AuditLog。

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
- 财务侧保存和确认记录 `basedOnContractRevision`。
- 任一侧修改后至少使本侧确认失效；合同侧修改累计结算、付款条款等财务依赖
  字段时，还必须使财务确认失效。
- 激活前允许带原因撤回本侧确认；激活后只能走更正记录。
- 激活要求合同侧当前 revision 已确认，且财务确认所依据的
  `financeBasisRevision` 等于合同侧当前值；`basedOnContractRevision` 保留
  追溯，非财务字段变化不强迫财务重复确认。
- 每笔历史实付至少一份凭证；一份凭证只能属于一笔历史实付。
- 双确认激活事务同时生成生效合同版本、结算类唯一历史期初结算或直接付款类
  合同容量，以及历史实付记录。
- 历史实付不生成普通付款审批实例，也不伪造成普通待审批付款申请。
- 历史预付款抵扣和异常更正只追加不可变 ledger/delta/reversal，不能覆盖原实付。
- 历史未付差额只是后续付款上限，不自动生成待付款申请。
- 异常超付未解除前，后续新付款必须由后端失败关闭。

### 主体与挂靠一致性

- 一个项目同一时刻只有一家挂靠企业。
- 业主主合同的签约主体是业主与挂靠企业，不写成我方合同。
- 挂靠企业签约业务不得创建我方付款执行；我方签约业务不得登记成挂靠代付。
- 挂靠企业外部合同、结算和付款只形成录入、确认、追加更正和审计，不形成
  我方审批实例。
- 业主向挂靠企业付款不增加我方可用资金；挂靠企业向我方拨款才增加。
- 挂靠扣款与到账差额分离；未经确认的差额不能自动成为成本。

### 合同分类与模板一致性

- 经办人只选择业务场景；一个场景只映射一个生效资料规则和一个默认版式。
- 六类合同由后端稳定枚举控制；旧 `generic_contract` 不再自动放行直接付款。
- 结算类合同正常付款必须基于生效结算，冻结合同预付款除外。
- 通用直接付款合同不创建形式结算；固定金额硬控累计占用，无固定总价则展示
  累计风险且仍受项目资金硬门禁。
- 资料规则、文件版式、标准条款和结算模板停用不改写历史版本。
- 风险手动停用阻断未提交草稿；自动换版停用要求升级或合同主管明确确认。
- 模板和场景治理只有合同主管可写，`super_admin` 不获得业务写权限。

### 支付与资金一致性

- 零星材料按同单合计金额判断，达到 3000 元硬性转材料采购审批。
- 零星费用必须关联项目，不设金额上限，不创建收货任务。
- 零星材料只有付款和收货都完成才办结，两者顺序不受限制。
- 项目资金在实际支付和凭证落库事务内再次检查；审批通过不预占垫资额度。
- 自有资金优先、垫资额度补足的分配由后端原子完成。
- 退款、终止和更正只追加流水，不删除原支付或原额度占用事实。

### 签名一致性

- 所有审批动作引用不可变手写签名版本。
- 电脑二维码和手机横屏创建的是同一签名版本协议。
- 缺少签名时后端阻断审批，前端提示不能代替后端校验。
- 历史审批 PDF 永远读取冻结版本，不读取用户当前签名。

### 能力矩阵一致性

- 每个可见按钮必须映射一个存在且唯一的前端 API 封装和后端业务路由。
- 每个后端业务路由必须声明页面入口、内部调用、接管动作或退出计划。
- 前端 API 封装没有生产消费者时删除，不以单测引用伪装业务消费者。
- 旧接口和小程序专属运行时只有在静态零调用、生产只读零调用和共享依赖盘点
  同时通过后才能删除。

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
pnpm run verify:capability-matrix
git diff --check
```

`verify:capability-matrix` 是本轮必须新增的根脚本名称；若仓库脚本命名按现有
约定调整，实施时同步修改本计划。预期：全部退出码为 `0`；Jest、Vitest 无
失败；Prisma schema 有效；UI 规则无新增违规；能力矩阵无未知路由、孤儿
封装或不存在的按钮目标。

## 生产发布硬门禁

在以下条件全部满足前，状态只能写“本地实现/验证完成”，不能写“发布完成”：

1. 合同部提供造成约 5 元差异的原始 Excel，已脱敏保留为测试夹具或记录 SHA-256 后受控保存。
2. 原始 Excel 在旧实现测试中能复现税率或金额差异，在新实现中通过并输出逐行对账。
3. 草稿迁移只读预检无阻断项；所有阻断项均人工处置，不自动猜测。
4. 预检使用数据库只读事务或只读账号，并将 apply 绑定到同一报告 SHA-256、
   数据库指纹和逐记录修订。
5. 生产备份、迁移、部署、前向恢复和只读验收按项目发布手册执行。
6. 普通合同员、合同部主管、财务人员、财务主管至少各完成对应权限的试运行。
7. Release C2 物理清理前至少完成 3–5 份真实合同闭环，且生产旧路由调用为零、
   人工迁移清单为零。
8. 至少各完成一条零星材料付款先行、收货先行、零星费用直接办结、固定金额
   直接付款、无固定总价直接付款和垫资额度补足链路。
9. 至少选择一个真实项目核对业主付款、挂靠拨款、扣款和我方可用资金不重复。
10. 小程序退役前证明近观察窗口无活跃客户端，并完成共享移动 Web、上传下载、
    登录和签名二维码回归。
11. 生产部署需用户另行明确授权；本实施计划不构成生产发布授权。

## 完成定义

只有满足以下条件，核心改造才可在 `PROGRESS.md` 标为 Release B/C1 完成：

- 五个实施包的代码、迁移、测试和文档均已合入同一发布候选。
- 旧工作台写接口和分散保存入口已关闭；检查点先保留只读观察，满足 Release C2
  门禁后才物理移除。
- 能力矩阵中不存在“前端按钮无后端实现”或“P0 后端能力无前端入口”。
- 能力矩阵中不存在无消费者前端 API、未分类后端业务路由或长期双义写路径。
- 六类合同、固定/无固定总价、零星材料/费用和全局资金硬门禁均完成后端、
  页面和真实岗位验收。
- 每个项目唯一挂靠企业及签约/付款主体一致性通过负向测试。
- 模板、版式、标准条款和业务场景已按用户语言收口，经办人无需选择内部版本。
- 所有审批单签名使用冻结手写签名版本。
- 原生小程序运行时退出且响应式 Web 手机链路可用；若数据库字段物理清理尚
  未授权，必须单列 Release C2，不得把运行时退出写成字段已删除。
- 真实 Excel 回归通过。
- Release A/B 发布、3–5 份真实业务闭环和发布后只读验证完成，且无生产业务
  数据异常；若 Release C2 尚未获得授权，必须明确记录为独立待办，不能把
  “代码切换完成”写成“物理清理完成”。
- Release C2 只有在另行授权、执行并验收后才能单独标为完成；它不是核心
  工作台上线完成状态的隐含组成，也不能因核心改造完成而自动执行。
