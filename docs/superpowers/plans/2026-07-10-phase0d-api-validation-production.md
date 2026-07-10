# Phase 0D API Validation And Production Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为关键写接口建立统一白名单输入校验和中文错误响应，并在金额、COS 迁移完成后重新验证数据库、构建、正式域名、HTTPS 和运行健康。

**Architecture:** 使用 NestJS 官方 `ValidationPipe`，把运行时已消失的 TypeScript interface DTO 逐步改为 class DTO。全局开启 transform、whitelist 和禁止未知字段；服务层继续负责业务规则。先覆盖登录和资金/归档类高风险写接口，再覆盖合同、结算、项目和费用入口，不借此重构业务服务。

**Tech Stack:** NestJS ValidationPipe, class-validator, class-transformer, Jest, Supertest-compatible controller tests, production readiness scripts.

---

## 范围边界

- DTO 校验负责形态：必填、字符串/布尔/数组、长度、枚举、日期格式和金额字符串格式。
- service 负责事实：权限、项目范围、状态迁移、额度、现金、版本、重复、资料齐全和审批人。
- 文件二进制继续由 Multer `FileInterceptor` 处理；下载密码和原因 DTO 进入统一校验。
- 不在本阶段把超大 service 拆层，不改变已有 API 路径。
- 新依赖仅限 NestJS 官方校验常用依赖 `class-validator` 和 `class-transformer`。

### Task 1: 建立全局校验基础设施

**Files:**

- Modify: `services/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `services/api/src/validation/api-validation.ts`
- Create: `services/api/src/validation/api-validation.spec.ts`
- Modify: `services/api/src/main.ts`

- [ ] **Step 1: 安装校验依赖**

```bash
pnpm --filter @jiangkong/api add class-validator class-transformer
```

Expected: 依赖写入 API package 和 lockfile，不新增其他运行框架。

- [ ] **Step 2: 先写全局 Pipe 失败测试**

测试要求：

- 未知字段被拒绝。
- 字符串不会自动转成任意 number 参与金额运算。
- 缺失/非法字段返回 HTTP 400 语义。
- 对外错误为中文，字段名通过 DTO 的中文 message 表达。

```bash
pnpm --filter @jiangkong/api test -- src/validation/api-validation.spec.ts --runInBand
```

Expected: 文件/实现不存在，测试失败。

- [ ] **Step 3: 实现统一 ValidationPipe**

`api-validation.ts` 导出：

```ts
export function createApiValidationPipe(): ValidationPipe
```

配置：

```ts
new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  stopAtFirstError: false,
  exceptionFactory: (errors) => new BadRequestException({
    message: "提交内容格式不正确，请检查后重试",
    errors: flattenChineseValidationErrors(errors)
  })
});
```

错误展平不得返回 validation decorator 名、堆栈或内部类名。

- [ ] **Step 4: 在 main.ts 启用**

在 CORS 前后均可，但必须在 `listen` 前：

```ts
app.useGlobalPipes(createApiValidationPipe());
```

- [ ] **Step 5: 验证并提交**

```bash
pnpm --filter @jiangkong/api test -- src/validation/api-validation.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/package.json pnpm-lock.yaml services/api/src/main.ts services/api/src/validation
git commit -m "feat: 启用 API 全局输入校验"
```

### Task 2: 覆盖认证与私有文件入口

**Files:**

- Modify DTOs in `services/api/src/auth/dto/`
- Modify: `services/api/src/auth/auth.controller.ts`
- Modify: `services/api/src/auth/auth.service.spec.ts`
- Create: `services/api/src/file/dto/create-download-ticket.dto.ts`
- Modify: `services/api/src/file/file.controller.ts`
- Modify: `services/api/src/file/file.controller.spec.ts`

- [ ] **Step 1: 将认证 DTO 从 interface 改为 class**

覆盖 `LoginDto`、`RefreshTokenDto`、`LogoutDto`、`ChangePasswordDto`、`WxLoginDto`：

- 手机号/账号、密码、token 必须是非空字符串。
- 密码长度使用现有 AuthService 业务规则，不在 DTO 引入不同标准。
- 所有校验 message 为中文。
- controller 改为运行时 import，不再 `import type`。

- [ ] **Step 2: 建立下载票据 DTO**

替换 `file.controller.ts` 内联 interface：

```ts
export class CreateDownloadTicketDto {
  @IsString({ message: "请输入当前登录密码" })
  @IsNotEmpty({ message: "请输入当前登录密码" })
  confirmationPassword!: string;

  @IsString({ message: "请填写下载原因" })
  @Length(1, 200, { message: "下载原因不能超过 200 个字" })
  downloadReason!: string;
}
```

service 中的二次防线保留。

- [ ] **Step 3: 增加 controller/service 测试**

覆盖空 body、数组 body、未知字段、空密码、超长原因和合法请求。

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  src/auth/auth.service.spec.ts \
  src/file/file.controller.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/src/auth services/api/src/file
git commit -m "feat: 校验认证与私有文件请求"
```

### Task 3: 覆盖资金类高风险写接口

**Files:**

- Modify DTOs under `services/api/src/payment/dto/`
- Modify: `services/api/src/payment/payment.controller.ts`
- Modify: `services/api/src/payment/payment.controller.spec.ts`
- Modify DTOs under `services/api/src/project-expense/dto/`
- Modify: `services/api/src/project-expense/project-expense.controller.ts`
- Modify: `services/api/src/project-expense/project-expense.controller.spec.ts`
- Modify project money DTOs under `services/api/src/project/dto/`
- Modify: `services/api/src/project/project.controller.ts`
- Modify: `services/api/src/project/project.controller.spec.ts`

- [ ] **Step 1: 为非法资金请求写失败测试**

普通付款、实付、财务记录、报销、零星采购、项目回款、业主主合同、代付和额度请求至少覆盖：

- 金额为 number 而非字符串。
- 金额含负号、小数点、指数或空白。
- fileId/projectId/sourceId 为空。
- 枚举状态不在允许集合。
- 日期不是 `YYYY-MM-DD` 或合法 ISO 时间。
- 额外未知字段。

- [ ] **Step 2: 把资金 DTO 改为 class**

所有 `*Cents` 使用：

```ts
@IsString({ message: "金额格式不正确" })
@Matches(/^(0|[1-9]\d*)$/, { message: "金额必须按分填写为 0 或更大的整数" })
```

是否允许 0 继续由具体 service 判断。审批 decision、付款 sourceType、expenseType 等用 `@IsIn` 并提供中文提示。

- [ ] **Step 3: 把 controller 的内联 body 改为命名 DTO**

覆盖付款转交/委托当前 `{ toUserId: string }`、PDF 生成当前 `{ templateKey?: string; departmentScope?: string }` 等内联类型，避免全局 Pipe 对 interface 无效。

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  src/payment/payment.controller.spec.ts \
  src/payment/payment-request.service.spec.ts \
  src/project-expense/project-expense.controller.spec.ts \
  src/project-expense/project-expense.service.spec.ts \
  src/project/project.controller.spec.ts \
  src/project/project.service.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/src/payment services/api/src/project-expense services/api/src/project
git commit -m "feat: 校验资金类写接口"
```

### Task 4: 覆盖合同、接管、结算和模板写接口

**Files:**

- Modify DTOs under `services/api/src/contract/dto/`
- Modify: `services/api/src/contract/contract.controller.ts`
- Modify DTOs under `services/api/src/contract-takeover/dto/`
- Modify: `services/api/src/contract-takeover/contract-takeover.controller.ts`
- Modify DTOs under `services/api/src/settlement/dto/`
- Modify: `services/api/src/settlement/settlement.controller.ts`
- Modify: `services/api/src/contract-template/dto/contract-template.dto.ts`
- Modify: `services/api/src/contract-template/contract-template.controller.ts`
- Modify affected controller/service specs in the same domains

- [ ] **Step 1: 为高风险非法结构写失败测试**

覆盖：

- 合同付款条款不是数组、数组项不是对象、阶段类型非法。
- 历史接管金额/等级/生命周期/日期非法。
- 结算 lines 为空、行来源非法、amountCents 非字符串。
- 模板版本/变量数据不是 plain object 或数组超限。
- 审批、归档和二次确认字段缺失。

- [ ] **Step 2: DTO class 化并保持 service 二次校验**

嵌套数组使用 `@ValidateNested({ each: true })` 和 `@Type(() => ChildDto)`。不得删除现有 service 的金额、状态、权限和版本校验。

- [ ] **Step 3: 验证并提交**

```bash
pnpm --filter @jiangkong/api test -- \
  src/contract/contract.controller.spec.ts \
  src/contract/contract.service.spec.ts \
  src/contract-takeover/contract-takeover.controller.spec.ts \
  src/contract-takeover/contract-takeover.service.spec.ts \
  src/settlement/settlement.controller.spec.ts \
  src/settlement/settlement.service.spec.ts \
  src/contract-template/contract-template.controller.spec.ts \
  src/contract-template/contract-template.service.spec.ts \
  --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/src/contract services/api/src/contract-takeover \
  services/api/src/settlement services/api/src/contract-template
git commit -m "feat: 校验合同结算写接口"
```

### Task 5: 建立中文错误回归检查

**Files:**

- Create: `services/api/scripts/check-business-errors.cjs`
- Modify: `services/api/package.json`
- Modify: `.github/workflows/deploy-production.yml`
- Modify known remaining critical English errors in:
  - `services/api/src/contract-bill/contract-bill-guards.ts`
  - `services/api/src/contract-bill/contract-bill.service.ts`
  - `services/api/src/contract-bill/contract-bill-excel.service.ts`
- Modify matching specs

- [ ] **Step 1: 创建只扫描用户可见 throw 的脚本**

脚本扫描 `services/api/src/**/*.ts` 中 `BadRequestException`、`ForbiddenException`、`NotFoundException` 和直接 `throw new Error` 的 ASCII-only 字符串。允许清单只包含真正内部/协议错误，并写明文件与原因；不得用目录级忽略。

- [ ] **Step 2: 修正首批合同清单英文错误**

把定价方式、草稿不可编辑、修订冲突、税率、Excel 缺表/重复应用/预览过期等用户可见错误改为中文，并同步测试。

- [ ] **Step 3: 接入 package 和 CI**

API package 增加：

```json
"check:business-errors": "node scripts/check-business-errors.cjs"
```

生产工作流在 lint 后执行该检查。

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @jiangkong/api check:business-errors
pnpm --filter @jiangkong/api test -- src/contract-bill --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api .github/workflows/deploy-production.yml
git commit -m "test: 阻止新增英文业务错误"
```

### Task 6: 阶段 0 全量生产复验

**Files:**

- Modify: `services/api/scripts/verify-production-readiness.cjs`
- Modify: `docs/progress/2026-07-10-release-baseline.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 本地全量自动验证**

```bash
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api check:business-errors
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @jiangkong/web-admin check:ui
pnpm --filter @jiangkong/api build
pnpm --filter @jiangkong/web-admin build
git diff --check
```

Expected: 全部退出 0。

- [ ] **Step 2: 生产发布前检查**

按阶段 0A 再做数据库备份、Prisma migration status、production readiness 和当前运行健康检查。确认 0B/0C 的迁移在备份后应用。

- [ ] **Step 3: 通过 main 发布**

遵循 `2026-07-10-phase0a-release-truth.md` Task 4，禁止绕过 GitHub Actions 直接覆盖服务器代码。

- [ ] **Step 4: 生产验收**

验证：

- `https://jgzg.site/` 和 `/api/health`。
- 登录、refresh、普通业务列表。
- 大额金额测试记录的创建/读取/清理。
- COS 上传、密码+原因下载、过期/篡改/越权拒绝。
- PostgreSQL migration status。
- `scripts/ops/check-runtime-health.sh`。

- [ ] **Step 5: 更新进度并提交**

`PROGRESS.md` 将阶段 0 标记完成，并明确阶段 1 唯一入口为组织权限与真实业务基础。

```bash
git add services/api/scripts/verify-production-readiness.cjs \
  docs/progress/2026-07-10-release-baseline.md PROGRESS.md
git commit -m "docs: 完成阶段零生产复验"
```

## 阶段 0D 退出标准

- 关键 mutation DTO 都是运行时 class，不再以 interface 假装校验。
- 未知字段、非法嵌套、非法金额和非法枚举在进入 service 前被 400 拒绝。
- service 的业务不变量测试无回退。
- CI 阻止新增 ASCII-only 用户可见业务错误。
- 金额、COS、数据库、Web/API、域名、HTTPS 和健康检查在同一生产 commit 上通过。
