# 建工智管零星采购真实表单重构实施计划

**日期：** 2026-07-18

**状态：** 设计已确认，等待用户授权开始业务代码实施

**设计依据：** `docs/superpowers/specs/2026-07-18-spot-procurement-real-form-redesign.md`

**目标：** 在现有独立零星采购模块上做前向重构，使系统真实复刻公司现行 A4 竖向《零星/小额材料采购申请表》和 A5 横向《项目零星付款申请单》，形成“无价采购审批 → 唯一付款申请 → 分次实际付款 → 收货复核 → 补货或退款 → 自动办结 → 发票可后补 → 不可变审批原件与版本化归档包”的闭环。

**架构：** 保留现有 NestJS、Prisma、PostgreSQL、Vue 3、TDesign、共享审批、私有文件、PDF、审计和试点白名单基础；通过前向迁移扩展现有 `SpotProcurement*` 模型，停止新流程写入商户余额和结构化票据覆盖能力，不新建第二套采购、审批、文件或签名系统。每个 Task 必须采用后端不变量优先、最小 TDD、独立提交和 `PROGRESS.md` 同步更新的方式完成。

**技术栈：** NestJS、TypeScript、Prisma 5、PostgreSQL 16、Jest、Vue 3、TDesign Vue Next、Vitest、Playwright、PDFKit、`sharp`、腾讯 COS 私有对象存储。

---

## 0. 当前基线与授权边界

计划编写时的已核事实：

- 当前候选分支为 `codex/spot-procurement`。
- 现有模块位于 `services/api/src/spot-procurement/`、`apps/web-admin/src/pages/spot-procurement/` 和 `packages/shared-domain/src/spot-procurement.ts`，不是从零开始。
- 现有 `CompanyEntity` 已保存我方公司名称、统一社会信用代码和启用状态，并已有 `/company-entities` API 与系统设置页；付款主体直接复用该字典。
- 现有实际付款已支持一张付款申请多笔执行、幂等、累计上限和作废；本轮补齐多凭证、批准渠道和新付款事实，不重建项目现金账本。
- 现有收货已支持唯一根单、修订、委托、原图/水印图、物资主管复核和正式 PDF；本轮调整开放条件、数量口径和办结关系。
- 现有审批 PDF 的“最新件”会随实际付款和退款刷新；本轮必须把审批完成原件与持续归档包拆开。
- 现有 `SupplierBalance*`、`InvoiceRecord`、无票确认和票据异常能力保留表结构，但新流程停止写入和停止作为办结条件。
- “费用与报销”仍是独立模块，既有借款、报销冲销、员工还款和员工项目往来设计不在本计划中修改；经办人垫付零星材料后的报回仍走零星付款，不生成普通报销单。
- 生产零星采购白名单为空，生产新零星采购业务记录为 0；入口关闭是当前正确状态。

本计划确认不授予以下权限：

- 不授权推送候选分支或合并 `main`。
- 不授权连接、读取或修改生产数据库。
- 不授权生产备份、生产迁移、部署或恢复试点白名单。
- 不授权冒用真实账号创建业务数据。

实施前必须重新读取 `PROGRESS.md`、`AGENTS.md`、设计文档和本计划，并确认生产入口仍关闭。任何 Task 只完成局部代码时都不得开放真实入口。

## 1. 全程不可破坏的不变量

1. 一张采购只有一个当前有效采购版本和一张当前有效付款申请。
2. 采购申请不保存实际商户、单价、金额、预计票据、收款对象、付款主体或付款方式。
3. 采购审批通过只自动创建付款草稿，不自动提交付款审批。
4. 付款明细只能引用当前已批准采购材料，付款数量不得超过采购批准数量。
5. 付款申请金额由后端按付款数量和含税/无票单价重算，客户端合计不入账。
6. 一张付款申请只有一个收款对象，可以登记多个属于该对象的收款渠道和多个拟付款方式。
7. 经办人垫付报回时，收款对象和账户持有人必须是经办人本人。
8. 实际商户和收款对象允许不一致，但不一致说明必填。
9. 所有实际付款使用同一批准我方付款主体和收款对象；每笔只能使用已批准方式和渠道。
10. 审批通过不等于实际付款；每笔实际付款和退款都必须拥有有效凭证。
11. 一张付款申请可有多笔实际付款，累计有效实付不得超过审批金额。
12. 第一次有效实际付款后才开放收货编辑和提交。
13. 一张采购只有一张最终收货根单，不建立批次或车辆实体。
14. 收货正式提交至少一张已成功生成服务端水印的材料现场照片；送货单可选且不能替代材料照片。
15. 实际到货不得静默超过采购批准数量；无偿附赠单列且不增加付款或发票金额。
16. 少货多付只允许补货或退款；新流程不得写商户余额、不得跨单抵扣。
17. 发票状态独立，不参与正常办结；正式办结后仍可追加发票文件。
18. 正常办结后采购、付款、收货和差异事实不可更正；发生实付后只能走财务主管确认的异常终止。
19. 采购和付款审批完成 PDF 永久冻结；实付、退款、办结和发票事实只能新增归档包版本。
20. 所有金额使用整数分和后端事务重算，所有敏感文件使用私有存储、权限校验和下载审计。

---

## Task 1：冻结新版领域契约、状态和权限动作

**目标：** 先把新语义固化在共享领域层，阻止 Web 和 API 各自发明状态或金额口径。

**文件：**

- 修改：`packages/shared-domain/src/spot-procurement.ts`
- 修改：`packages/shared-domain/src/permissions.ts`
- 新增：`packages/shared-domain/src/spot-procurement.test.ts`
- 修改：`packages/shared-domain/src/permissions.test.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试，覆盖采购/付款/收货/差异/发票/异常终止状态，以及允许的付款类型、渠道、预计票据类型和附件类别。
2. 增加并统一导出：
   - 采购、付款、收货、差异和异常终止状态常量；
   - `company_direct` 与 `handler_reimbursement` 付款类型；
   - 银行、微信、支付宝、现金、其他等付款方式/收款渠道；
   - 无发票、增值税普通发票、增值税专用发票；
   - 发票状态 `not_required`、`pending`、`uploaded`；
   - 归档包状态与版本触发原因。
3. 新增最小业务动作：付款主体/方式维护、实际付款、退款、发票附件、异常终止、归档包下载；移除新页面对商户余额和结构化票据动作的依赖，但暂不删除旧常量。
4. 明确状态转换纯函数，禁止 `closed` 返回业务编辑状态，允许 `closed` 追加发票归档。
5. 运行：

```bash
pnpm --filter @jiangkong/shared-domain test -- spot-procurement.test.ts permissions.test.ts
pnpm --filter @jiangkong/shared-domain typecheck
```

6. 更新 `PROGRESS.md` 并提交：

```text
feat: define real-form spot procurement contracts
```

## Task 2：新增前向数据模型并建立数据库硬约束

**目标：** 用兼容迁移承载新版事实；生产为零记录时仍必须先预检，禁止破坏性删除旧列和旧表。

**文件：**

- 修改：`services/api/prisma/schema.prisma`
- 新增：`services/api/prisma/migrations/<timestamp>_spot_procurement_real_form_redesign/migration.sql`
- 新增：`services/api/prisma/schema.spec.ts`
- 修改：`services/api/prisma/verify-spot-procurement-concurrency.cjs`
- 修改：`PROGRESS.md`

**数据模型：**

- `SpotProcurementVersion` 增加手填申请部门/申请人、采购人姓名快照、采购部门 ID/名称快照、统一要求到位日期；旧商户和合计字段改为可空并标记 legacy。
- `SpotProcurementLine` 保留采购名称、型号、单位、批准数量和备注；旧价格、金额、发票字段改为可空，新流程不写。
- `SpotProcurementPayment` 增加实际商户文本、付款类型、收款对象不一致说明、我方付款主体 ID/名称/统一社会信用代码快照、审批金额、主要渠道、提交版本号和关键事实冻结时间。
- 新增付款材料明细表，保存采购行引用、批准数量快照、付款数量、单价、金额、预计票据类型、预计税率及标签快照。
- 新增收款渠道表和拟付款方式表，付款内排序唯一；账户号以业务快照保存，列表读模型必须脱敏。
- 新增付款依据附件表和实际付款凭证表，使一张付款、一笔执行均可保存多份文件。
- 新增轻量发票附件表，关联整张付款申请，只保存文件、状态、上传人、时间和失效原因，不保存结构化票面数据。
- 新增归档包版本/文件表，区分不可变审批原件、A4 明细、付款执行、退款和发票附件。
- 新增异常终止事实，保存发起人、原因、财务主管确认人和时间。
- 扩展差异/退款事实，保存少货未执行额度关闭、补货或退款结果；不新增商户余额引用。

**数据库约束：**

- 对一张采购建立“仅一张当前有效付款”的部分唯一索引。
- 付款材料行必须唯一引用采购行，数量和金额使用非负检查约束。
- 付款渠道、拟付款方式、执行凭证、发票附件和归档包版本建立稳定唯一键与必要索引。
- 文件绑定继续接入中央独占绑定触发器；同一私有文件不得同时冒充付款依据、实付凭证、退款凭证或发票。
- 迁移开头必须检查新零星采购表计数；非零时明确失败并要求单独数据迁移方案，不静默回填猜测值。

**验证：**

```bash
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder pnpm --filter @jiangkong/api prisma format
DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder pnpm --filter @jiangkong/api prisma validate
pnpm --filter @jiangkong/api test -- prisma/schema.spec.ts
git diff --check
```

使用一次性 PostgreSQL 16 空库顺序应用全量迁移；本 Task 不连接生产。更新 `PROGRESS.md` 后提交：

```text
feat: add spot procurement real-form schema
```

## Task 3：重构零星采购申请为“无价材料审批”

**目标：** 采购阶段只审批纸质 A4 表上的申请文本、材料和统一到位日期。

**文件：**

- 修改：`services/api/src/spot-procurement/dto/create-spot-procurement.dto.ts`
- 修改：`services/api/src/spot-procurement/dto/update-spot-procurement-draft.dto.ts`
- 修改：`services/api/src/spot-procurement/dto/create-spot-procurement-version.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-application.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.controller.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement.controller.spec.ts`
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试，证明旧 DTO 仍要求供应商、价格、金额和票据，并证明新字段尚未冻结。
2. 新建/更新草稿只接受：项目、手填申请部门、手填申请人、统一要求到位日期、采购原因、说明、材料明细和附件。
3. 采购人必须是当前登录物资员或物资主管；自动读取其当前部门，保存采购人/采购部门快照，客户端不能覆盖。
4. 同项目历史建议提供有界、去重接口，只返回申请部门和申请人文本及来源版本 ID；选择建议只复制文本，不创建用户/部门关系。
5. 提交时冻结手填文本、采购人、采购部门、统一日期、材料和附件；审批流保持物资主管 → 项目经理，物资主管发起时记录跳过事实但不伪造签名。
6. 采购批准后在同一事务内幂等创建唯一付款草稿；不得提交付款，不得写金额、商户余额或结构化票据。
7. 尚无实付时允许采购版本变更；任何实付后拒绝普通版本变更。撤销采购时使未付款付款申请失效并保留历史。
8. 定向验证：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-application.service.spec.ts spot-procurement.controller.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: make spot procurement application amount-free
```

## Task 4：建立唯一付款草稿、付款明细与实际商户事实

**目标：** 把价格、金额、预计票据、实际商户和收款对象完整移到付款申请。

**文件：**

- 修改：`services/api/src/spot-procurement/dto/update-spot-procurement-payment-draft.dto.ts`
- 新增或修改：付款渠道、付款附件 DTO
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-payment.controller.spec.ts`
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试覆盖：一张采购重复有效付款、付款行越过批准数量、客户端伪造金额、商户与收款对象不一致未说明、经办人垫付收款人不是本人。
2. 删除/禁用 `createNextDraft` 等并行付款入口；只有批准采购自动生成的当前草稿可编辑。前一付款未实付且明确失效后，才允许创建替代草稿。
3. 付款草稿继承采购材料名称、型号、单位和批准数量；经办人填写付款数量、单价、预计票据与税率，后端逐行重算金额和总额。
4. 发票普通/专用时税率必填且单价解释为含税单价；无发票时税率必须为空。
5. 实际商户为自由文本；提供同项目历史名称建议，选择只复制名称，不复制账户、不创建 `BusinessParty`、不跨项目联想。
6. 保存一个收款对象和多个收款渠道；指定主要渠道供 A5 主表展示，其余进入 A4 明细。
7. 公司直付允许商户与收款对象不同并要求简短说明；经办人垫付报回自动写入固定说明并锁定本人收款身份。
8. 付款依据附件全部可选，支持报价单、收据、发票、Excel、Word、PDF 和其他允许类型。
9. 提交付款时允许付款主体暂为空，但冻结经办人填写的商户、明细、收款和附件；付款主体闸门在 Task 5 完成。
10. 定向验证：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-payment.controller.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

11. 更新 `PROGRESS.md` 并提交：

```text
feat: capture spot procurement payment facts
```

## Task 5：复用我方公司字典并实现付款主体阶段控制

**目标：** 不新建公司主数据，让财务人员、综合部主管或财务主管在合法阶段选择真实出款公司。

**文件：**

- 复用不改：`services/api/src/company-entity/company-entity.service.ts`
- 复用不改：`services/api/src/company-entity/company-entity.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- 新增：`services/api/src/spot-procurement/dto/update-spot-payment-payer.dto.ts`
- 修改：对应 Jest 测试
- 修改：`apps/web-admin/src/api/core-flow-read.api.ts`（仅在现有类型不足时）
- 修改：`PROGRESS.md`

**步骤：**

1. 复用 `CompanyEntity` 的 ID、名称、统一社会信用代码和启用状态；付款只能选择启用主体，历史快照不随字典改名而变化。
2. 新增受控命令维护付款主体和拟付款方式：经办人无权操作；项目财务人员、综合部主管、财务主管按项目岗位与当前审批阶段授权。
3. 综合部主管尝试审批通过时，付款主体和至少一种拟付款方式必须已确定。
4. 综合部审批完成前允许三类角色调整；综合部审批后普通角色锁定。
5. 财务主管在自己的审批节点可以填写变更原因后调整；服务端保留原审批动作，撤销综合部与项目经理本轮通过结果，并从综合部节点重新审批。
6. 最终 OR 签完成或存在任一有效实际付款后永久锁定付款主体、拟方式、商户、收款对象、渠道和金额事实。
7. 每次选择、调整、重审原因、旧值和新值均写审计；审计不保存完整账号。
8. 定向验证：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-payment.controller.spec.ts
pnpm --filter @jiangkong/api typecheck
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: control spot payment payer entity
```

## Task 6：重构付款审批流、节点重启和固定签字语义

**目标：** 固化经办人 → 综合部主管 → 项目经理 → 财务主管 → 董事长/总经理 OR 签，并保证重审和签名事实真实。

**文件：**

- 修改：`services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-approval-nodes.ts`
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 先写付款提交、各节点通过/退回、财务主管换主体后从综合部重启、OR 签单人完成、跳过/未处理不生成签名的失败测试。
2. 付款提交者快照映射 A5“经办人”；项目经理映射“部门经理”；综合部主管映射“综合部”；财务主管映射“财务部”；实际终审人映射“董事长/总经理”。
3. 财务人员选择付款主体只是业务维护动作，不生成审批动作或签名。
4. 审批人只能通过、退回、驳回、转办/委托等审批动作，不能直接修改商户、收款、材料、数量、价格或金额。
5. 审批完成时冻结付款审批快照和签名引用，进入 `approved_pending_payment`；PDF 在 Task 12 生成。
6. 运行：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

7. 更新 `PROGRESS.md` 并提交：

```text
feat: align spot payment approval flow
```

## Task 7：扩展多次实际付款、批准渠道与逐笔凭证

**目标：** 保留现有实际付款事务和资金账本，补齐同一付款主体/收款对象、不同批准方式/渠道和多文件凭证。

**文件：**

- 修改：`services/api/src/spot-procurement/dto/record-spot-procurement-payment.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-payment.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-access.service.ts`
- 修改：对应 Jest 与并发验证脚本
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试：未审批付款、未批准方式/渠道、跨付款渠道、无凭证、累计超额、不同付款主体/收款对象、幂等键冲突。
2. 每笔执行保存金额、时间、批准方式、批准渠道、财务操作人、付款主体/收款对象引用、幂等键和一至多份凭证。
3. 银行转账要求银行回单；微信/支付宝要求支付成功证明；现金只要求收据。发票不属于实付凭证。
4. 继续在同一 Serializable 事务中校验项目现金、累计上限、执行状态、文件有效性和独占绑定；审批金额不可被实付改写。
5. 第一笔有效实付后幂等开放收货，不得因收货初始化失败回滚已经成功的资金事实；失败要审计并可重试。
6. 执行作废继续保留原记录并重算累计实付；已办结后不得作废，除非另有已确认的专门财务更正设计，本轮不新增。
7. 运行：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-payment.service.spec.ts spot-procurement-access.service.spec.ts
pnpm --filter @jiangkong/api verify:spot-procurement-concurrency:local
```

8. 更新 `PROGRESS.md` 并提交：

```text
feat: record multi-execution spot payments
```

## Task 8：调整收货开放条件、数量事实、委托与水印

**目标：** 复用现有收货根单和修订能力，改为第一次实付后可办、按采购材料保存实际到货和无偿附赠。

**文件：**

- 修改：`services/api/src/spot-procurement/dto/update-receipt-draft.dto.ts`
- 修改：`services/api/src/spot-procurement/dto/attach-receipt-photo.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-receipt.service.ts`
- 修改：`services/api/src/spot-procurement/receipt-watermark.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-receipt.controller.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-receipt.controller.spec.ts`
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试：零实付编辑/提交、无材料照片、仅送货单、定位字段、超批准数量未标无偿附赠、非委托人提交、办结后更正。
2. 收货根单可在采购批准时预建以保持 1:1，但零实付时详情只返回阻断原因，写接口失败关闭。
3. 每条采购材料保存实际到货数量、无偿附赠数量和差异说明；不允许客户端填写实际成本。
4. 采购经办人可委托同项目人员；保存委托人、受托人、实际操作人、范围和时间，委托不转移业务责任。
5. 至少一张材料照片；送货单照片可选。相机和相册均允许，不请求、不保存、不校验定位。
6. 服务端水印信息卡显示项目名称、采购编号、上传时间、上传人和可选备注，保留原图/水印图/哈希/来源并走私有文件授权。
7. 首次提交后既有照片锁定，只能追加并说明；办结前可撤回复核并创建新修订，历史修订和复核记录保留；办结后拒绝更正。
8. 物资主管通过/退回，不增加合同部主管或额外审批节点。
9. 运行：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-receipt.service.spec.ts receipt-watermark.service.spec.ts spot-procurement-receipt.controller.spec.ts
pnpm --filter @jiangkong/api typecheck
```

10. 更新 `PROGRESS.md` 并提交：

```text
feat: gate and review spot procurement receipt
```

## Task 9：重写少货差异、补货、退款和自动办结

**目标：** 完全取消新流程商户余额，只按付款审批单价和物资主管复核数量计算差异。

**文件：**

- 修改：`services/api/src/spot-procurement/spot-procurement-settlement.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-closure.service.ts`
- 修改：`services/api/src/spot-procurement/dto/create-procurement-discrepancy.dto.ts`
- 修改：`services/api/src/spot-procurement/dto/record-procurement-refund.dto.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-balance.service.ts`（仅隔离旧入口）
- 修改：对应 Jest 与并发测试
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试，证明旧流程仍可转商户余额、发票仍阻断办结或客户端可填写差异金额。
2. 后端按付款审批冻结单价计算：`实际应付 = Σ(物资主管认可到货 × 付款单价)`，`多付 = 有效实付 - 有效退款 - 实际应付`。
3. 少货且存在未付额度时记录关闭未执行额度，保留原审批金额；不得修改审批单或虚构退款。
4. 少货多付只允许：
   - 商户补货：通过新收货修订重新复核；
   - 商户退款：财务人员登记金额、时间、方式和有效退款凭证。
5. 新服务、controller 和 Web API 不再调用 `creditSupplierBalance`、`executeSupplierBalance` 或余额预留；旧表和历史路由暂不物理删除，但新 capability 下固定不可用并写审计。
6. 正常办结条件只包含付款审批完成、资金结算完成、收货复核通过、无待处理差异；发票状态不得参与。
7. 使用事务锁与 CAS 确保最后一个事实只办结一次；办结后锁定收货并拒绝业务更正。
8. 运行：

```bash
pnpm --filter @jiangkong/api test -- spot-procurement-settlement.service.spec.ts spot-procurement-closure.service.spec.ts spot-procurement-balance.service.spec.ts
pnpm --filter @jiangkong/api verify:spot-procurement-concurrency:local
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: settle spot shortages by replenishment or refund
```

## Task 10：实现实付后的异常终止

**目标：** 实付前继续普通撤销，实付后只允许经办人或财务人员发起、财务主管单独确认异常终止。

**文件：**

- 新增：异常终止 DTO
- 修改：`services/api/src/spot-procurement/spot-procurement-application.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-settlement.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-access.service.ts`
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 先写失败测试覆盖无实付误走异常终止、无权发起、项目经理确认、财务主管重复确认、办结后终止。
2. 任一有效实付后拒绝普通撤销；采购经办人或项目财务人员可发起并填写原因。
3. 只有有效财务主管可确认；项目经理只有查看权，不是审批节点。
4. 确认后状态为 `abnormally_terminated`，保留全部审批、实付、收货、退款、附件和审计，不显示正常办结。
5. 本轮不增加损失核销、坏账或额外审批流程。
6. 运行定向 Jest、API typecheck 和 lint，更新 `PROGRESS.md` 后提交：

```text
feat: add spot procurement abnormal termination
```

## Task 11：把发票收口为付款级可追加文件

**目标：** 停止新流程写结构化发票账本、无票确认和票据异常，以轻量附件状态支持办结前后补传。

**文件：**

- 新增：`services/api/src/spot-procurement/dto/attach-spot-payment-invoice.dto.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-invoice.service.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-invoice.controller.ts`
- 新增：对应 service/controller Jest 测试
- 修改：`services/api/src/spot-procurement/spot-procurement.module.ts`
- 修改：`services/api/src/invoice-ledger/invoice-ledger.controller.ts`
- 修改：`services/api/src/invoice-ledger/invoice-ledger.service.ts`
- 修改：`services/api/src/archive/archive.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.ts`
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 经办人和当前项目财务人员可向整张付款申请上传图片或 PDF；默认按一份展示，允许追加多份。
2. 只保存文件、上传人、时间、哈希和审计；不录发票号码、日期、金额、销方、税额，不 OCR、不验真、不分摊。
3. 状态由后端推导：全部付款行无发票为 `not_required`；预计有票无有效文件为 `pending`；至少一份有效文件为 `uploaded`。
4. 发票不参与办结；办结后上传只增加归档事实，不改变采购/付款状态、不重开审批。
5. 办结前误传文件可按现有文件失效机制记录原因；办结后只允许追加，不修改既有业务和审批事实。
6. 新零星采购 capability 下旧结构化票据、无票确认和票据异常写路由固定拒绝；历史读取继续保留，避免破坏旧数据。
7. 运行：

```bash
pnpm --filter @jiangkong/api test -- invoice-ledger.service.spec.ts invoice-ledger.controller.spec.ts spot-procurement-read.service.spec.ts archive.service.spec.ts
pnpm --filter @jiangkong/api typecheck
```

8. 更新 `PROGRESS.md` 并提交：

```text
feat: attach invoices to spot payments
```

## Task 12：生成不可变 A4/A5 审批原件和版本化归档包

**目标：** 审批 PDF 只生成审批结束事实，后续付款、退款和发票只新增归档包版本。

**文件：**

- 修改：`services/api/src/approval/approval-form.service.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-form-renderer.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-form-renderer.spec.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-payment-archive.service.ts`
- 新增：`services/api/src/spot-procurement/spot-procurement-payment-archive.service.spec.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement.module.ts`
- 修改：`services/api/src/archive/archive.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-access.service.ts`
- 修改：对应 PDF、归档、并发 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. A4 采购审批原件严格按设计：标题、项目名称、系统采购编号、申请部门/申请人/采购部门、采购人、统一到位日期、六列材料表、采购原因、物资部部长和项目经理意见；不显示申请日期、商户、价格、金额或票据。
2. A5 付款审批原件严格按已确认照片和视觉稿：项目/申请日期、付款主体、事由、大小写金额、付款类型/拟方式、主要收款渠道、五个固定签字区；保持 A5 横向边界和均衡垂直留白。
3. A4 付款明细展示实际商户、收款对象差异、付款材料/价格/预计票据、全部批准渠道、附件目录、审批/实付/退款/净付/剩余和状态。
4. 采购和付款审批最终完成后生成不可变 PDF；使用审批快照 token 和 CAS，重复触发幂等，任何实付/退款/发票动作不得刷新或替换审批原件。
5. 归档包版本顺序固定为 A5 原件、A4 明细、可选付款依据、逐笔实付/凭证、发票；图片/原 PDF 可入页，Word/Excel 只列附件目录并保留原文件。
6. 付款审批、每笔实付、执行作废、退款、正常办结、异常终止、发票上传各创建新归档版本；旧版本和文件永久保留。
7. 生成在业务事务外 best-effort 执行；失败写安全审计并允许重试，不回滚审批、付款、退款或发票上传。
8. 使用 PDF 文本/MediaBox 测试与渲染截图验证 A4 竖向、A5 横向、九行以上材料续页、长项目名/商户名和中文金额大写。
9. 运行：

```bash
pnpm --filter @jiangkong/api test -- approval-form.service.spec.ts archive.service.spec.ts spot-procurement-access.service.spec.ts
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
```

10. 更新 `PROGRESS.md` 并提交：

```text
feat: freeze spot approval PDFs and version archives
```

## Task 13：重构只读模型、工作台接口和最小权限

**目标：** 让列表、详情和归档读取只暴露新版事实，不再展示假采购金额、商户余额或票据覆盖。

**文件：**

- 修改：`services/api/src/spot-procurement/spot-procurement-read.service.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-read.controller.ts`
- 修改：`services/api/src/spot-procurement/spot-procurement-access.service.ts`
- 修改：`services/api/src/permission/permission.guard.ts`（仅需时）
- 修改：对应 Jest 测试
- 修改：`PROGRESS.md`

**步骤：**

1. 采购工作台金额字段改为关联付款事实：付款未形成时返回“待确定”语义；形成后返回审批金额、累计实付、退款、净付和剩余，不用采购根单 `approvedAmountCents=0` 冒充金额。
2. 付款工作台返回付款主体、商户、收款对象脱敏摘要、审批金额、累计实付、退款、净付、剩余、收货和发票状态。
3. 收货工作台返回第一笔实付开放状态、当前修订、材料照片/送货单、委托、复核和差异下一步。
4. 详情区分不可变审批原件与最新/历史归档包，返回可重试状态但不暴露私有 object key。
5. 查看/下载继续最小授权：本人、项目业务岗位、真实审批参与人和财务办理人按事实授权；完整账户、凭证、发票和归档包只对必要角色开放。
6. 列表账号脱敏；敏感下载填写原因、写审计、使用短时效 URL 和下载水印。
7. 旧商户余额和结构化票据字段不再出现在新 read model；历史 API 不伪造成新事实。
8. 运行定向 Jest、API typecheck/lint，更新 `PROGRESS.md` 后提交：

```text
feat: expose spot procurement real-form read models
```

## Task 14：重构 Web 零星采购工作台和采购详情

**目标：** 用户先完成熟悉的 A4 采购申请，不在采购阶段看到或填写价格和商户。

**文件：**

- 修改：`apps/web-admin/src/api/spot-procurement.api.ts`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementDetailPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/components/ProcurementLineEditor.vue`
- 新增或修改：申请文本建议、附件、状态摘要组件
- 修改：`apps/web-admin/src/pages/spot-procurement/spot-procurement-pages.test.ts`
- 修改：`apps/web-admin/src/pages/spot-procurement/spot-procurement-attachments.test.ts`
- 修改：`PROGRESS.md`

**步骤：**

1. 工作台列出编号、项目、申请部门、申请人、采购人、要求到位日期、状态、关联付款金额和下一步；未形成付款时显示“待确定”。
2. 新建/编辑区只显示手填申请部门、手填申请人、采购部门只读、采购人只读、统一到位日期、采购原因、材料和可选附件。
3. 同项目历史申请部门/申请人建议只填文本，UI 不出现“创建账号/部门”暗示。
4. 材料编辑器只保留名称、型号、单位、数量和备注；删除供应商、单价、金额、发票和税率字段。
5. 详情展示采购审批、唯一付款、实付、收货、差异、发票状态、审批原件和归档版本入口。
6. 使用 TDesign 和现有 `--jg-*` token，不新增 UI 库或平行设计系统。
7. 运行：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts spot-procurement-attachments.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
```

8. 更新 `PROGRESS.md` 并提交：

```text
feat: rebuild spot procurement application workbench
```

## Task 15：重构 Web 零星付款工作台和详情

**目标：** 在 A5 付款申请对应页面完成商户、付款材料、收款、付款主体和审批办理。

**文件：**

- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementPaymentDetailPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/components/PaymentCompositionCard.vue`
- 新增：付款材料编辑器、商户建议、收款渠道、付款主体阶段面板、付款依据附件组件
- 修改：Web API 与 Vitest
- 修改：`PROGRESS.md`

**步骤：**

1. 经办人表单填写实际商户、付款类型、商户/收款不一致说明、一个收款对象、多个渠道、材料付款数量/单价/预计票据、拟付款方式和可选附件。
2. 历史商户名称只限同项目，只复制名称，不复制账户或创建供应商。
3. 经办人看得到付款主体状态但不能选择；财务人员/综合部主管/财务主管只在合法阶段看到编辑动作。
4. 财务主管换主体时必须二次确认原因，并清楚提示综合部和项目经理需要重审。
5. 详情展示多笔实际付款、各自凭证、累计实付、退款、净付、剩余、发票状态、A5 原件、A4 明细和归档版本。
6. 银行账号列表脱敏，只有获权详情动作读取完整账户。
7. 运行目标 Vitest、Web typecheck/lint/check:ui，更新 `PROGRESS.md` 后提交：

```text
feat: rebuild spot procurement payment workbench
```

## Task 16：完成 Web 收货、差异、退款、发票和归档闭环

**目标：** 把第一次实付后的现场办理和财务收口接成一个可理解的下一步流程。

**文件：**

- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptWorkbenchPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/SpotProcurementReceiptPage.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/components/ReceiptLineEditor.vue`
- 修改：`apps/web-admin/src/pages/spot-procurement/components/ReceiptPhotoUploader.vue`
- 修改：结算摘要、状态摘要、发票和归档组件
- 删除新页面对 `SupplierBalancePanel.vue`、`InvoiceCoveragePanel.vue` 的使用；组件物理删除仅在无其他引用时进行
- 修改：Web API、Vitest、Playwright 夹具
- 修改：`PROGRESS.md`

**步骤：**

1. 零实付时明确显示“完成首笔实际付款后开放收货”，不显示可用提交按钮。
2. 收货按采购材料填写实际到货和无偿附赠，支持委托、相机/相册、材料照片必传、送货单可选、水印预览和追加原因。
3. 物资主管可通过/退回；办结前新修订保留历史，办结后页面只读。
4. 差异页面只提供补货或退款；彻底移除“转商户余额”和跨单抵扣操作。
5. 财务登记退款金额、时间、方式和凭证；页面展示审批、实付、退款、净付和未执行额度关闭。
6. 发票按付款级附件上传，办结前后均可追加；不出现票号、金额、OCR、验真、覆盖或无票复核字段。
7. 清楚区分“审批原件”和“最新归档包/历史版本”，归档生成失败提供获权重试入口。
8. 运行：

```bash
pnpm --filter @jiangkong/web-admin test -- spot-procurement-pages.test.ts spot-procurement-attachments.test.ts
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/web-admin check:ui
```

9. 更新 `PROGRESS.md` 并提交：

```text
feat: complete spot procurement receipt and archive UI
```

## Task 17：全链路回归、并发、迁移和视觉验收

**目标：** 在不开放入口的前提下证明新版规则完整、旧能力隔离、迁移可恢复。

**文件：**

- 修改：`services/api/src/spot-procurement/spot-procurement.e2e-spec.ts`
- 修改：`services/api/prisma/verify-spot-procurement-concurrency.cjs`
- 修改：`apps/web-admin/e2e/spot-procurement-workbenches.e2e.ts`
- 新增或修改：PDF 视觉验收夹具与证据说明
- 修改：`PROGRESS.md`

**自动场景至少覆盖：**

1. 无价采购审批后生成唯一付款草稿。
2. 公司直付，商户与收款对象一致，一次付款、一次收货。
3. 商户与个人收款对象不同并填写说明。
4. 经办人垫付报回并锁定本人收款。
5. 一张付款两次实际付款，各自凭证，首笔后开放收货。
6. 现金付款只上传收据，后续补传发票。
7. 全部无票并正常办结。
8. 预计有票但待补发票办结，办结后补传不重开流程。
9. 同项目受托人相册上传并确认，物资主管复核。
10. 少货后商户补货。
11. 少货多付后退款并上传凭证。
12. 实付后财务主管确认异常终止。
13. 审批 PDF 哈希永久不变，付款/退款/发票只新增归档包版本。

**并发与失败补偿：**

- 同采购重复付款草稿。
- 同付款并发提交/审批/换主体。
- 多笔实付累计超限、幂等重放和凭证独占。
- 收货复核、补货修订、退款和自动办结竞态。
- 发票追加与办结竞态。
- 审批 PDF 重复生成和归档包乱序完成。
- PDF/归档生成失败不反噬业务事实。
- 新流程无法调用商户余额或结构化票据写路径。

**完整门禁：**

```bash
pnpm --filter @jiangkong/shared-domain test
pnpm --filter @jiangkong/api test
pnpm --filter @jiangkong/web-admin test
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/web-admin typecheck
pnpm --filter @jiangkong/api lint
pnpm --filter @jiangkong/web-admin lint
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api verify:spot-procurement-concurrency:local
pnpm --filter @jiangkong/web-admin test:e2e:p0
git diff --check
```

从空库和最新生产备份的隔离恢复库分别顺序应用全量迁移。读取生产备份和创建恢复演练属于生产操作，必须在 Task 18 获得授权后才执行；本 Task 默认只用本地合成空库。

逐页人工验收 A4 采购、A5 付款和 A4 明细：纸张尺寸、边距、固定签字格、董事长/总经理区域、长文本、九行以上续页和页码均通过后，更新 `PROGRESS.md` 并提交：

```text
test: verify spot procurement real-form flow
```

## Task 18：发布候选、受控试点和重新开放闸门

**目标：** 只有在本地完成、用户另行授权和生产证据通过后，才重新开放一个项目试点。

**文件：**

- 修改：`docs/superpowers/runbooks/2026-07-16-spot-procurement-pilot.md`
- 修改：`docs/progress/2026-07-16-spot-procurement-pilot-release.md`
- 修改：`PROGRESS.md`
- 必要时修改：生产就绪/健康/试点验证脚本

**阶段 A：候选审计，不触碰生产**

1. 核对分支拓扑、目标 SHA、迁移列表、全部测试、未提交文件和 `.superpowers/` 忽略边界。
2. 核对生产入口仍关闭，发布文档明确当前生产代码与候选差异。
3. 形成候选验收包：测试结果、迁移影响、回滚原则、A4/A5/A4 视觉证据、13 个 UAT 脚本和最小权限名单。
4. 等待用户分别授权推送/合并、生产备份、隔离恢复、生产迁移、部署、白名单恢复和真实 UAT。

**阶段 B：获授权后的生产发布**

1. 绑定精确候选 SHA，推送候选并快进合并 `main`。
2. 执行最新生产备份，校验本地/异机哈希和可恢复性。
3. 在隔离恢复库先应用全部迁移并跑不变量验证；再次确认零星采购新表为 0。若非零立即停止。
4. 部署 API/Web，确认运行 SHA、数据库迁移、内外网 `/health`、Nginx、PostgreSQL、COS 私有文件和审计正常。
5. 先保持白名单为空做只读健康检查，再按用户授权仅恢复指定试点项目。

**阶段 C：真实人员 UAT**

1. 由真实人员本人登录，不代输密码、不后台伪造签字。
2. 至少完成一条最小链路和 13 个受控场景抽验；每个场景核对 API、数据库、Web、PDF/归档、文件权限和审计。
3. 验证失败立即重新关闭白名单；应用回滚不执行破坏性 down migration，保留新增事实并另行处理。
4. 只有用户确认 Go、全部证据归档并更新 `PROGRESS.md` 后，Task 18 才能标记完成。

**最终提交：**

```text
docs: record spot procurement real-form release
```

---

## 19. 计划自检矩阵

| 已确认业务规则 | 落地 Task |
| --- | --- |
| A4 无价采购申请、手填申请人/部门、统一日期 | 2、3、12、14 |
| 采购审批后唯一付款草稿 | 2、3、4 |
| 商户在付款阶段、历史名称快捷选择 | 4、15 |
| 付款数量/单价/预计票据/税率 | 2、4、15 |
| 一收款对象、多渠道、商户可与收款人不同 | 2、4、15 |
| 经办人垫付报回仍走零星付款 | 4、15 |
| 我方付款主体由财务/综合部/财务主管选择 | 5、6、15 |
| 一张付款多次实际付款和逐笔凭证 | 2、7、15 |
| 首笔实付后开放收货、无定位、水印、送货单可选 | 7、8、16 |
| 物资主管复核、委托同项目人员 | 8、16 |
| 取消商户余额，只允许补货或退款 | 9、16 |
| 发票不必传、付款级文件、办结后可追加 | 11、16 |
| 实付后异常终止由财务主管确认 | 10、16 |
| A4/A5 原件不可变、A4 明细和版本化归档包 | 12、13、15、16 |
| 最小查看/下载权限 | 13 |
| 生产继续关闭并重新授权后才开放 | 17、18 |

## 20. 完成定义

只有以下条件全部满足，才能宣称本重构完成：

- Task 1—17 的代码、迁移、测试、视觉验收和进度提交全部完成。
- 新流程不再写商户余额、结构化发票覆盖或无票确认。
- 采购无价、唯一付款、多次实付、首付后收货、补货/退款、发票后补和异常终止均由后端不变量保护。
- A4 采购、A5 付款和 A4 明细符合已确认纸质布局；审批原件哈希不被后续事实改写。
- 空库和获授权后的生产备份隔离恢复迁移均通过。
- 13 个受控场景、最小权限、私有文件、审计、并发和失败补偿均通过。
- 用户重新授权部署和试点，并由真实人员完成 UAT 后明确确认 Go。

只完成页面、只修改 PDF、只完成本地代码、只部署但未 UAT，或只恢复白名单，均不能将 Task 18 或本计划标为完成。
