# Phase 0C COS Private Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有 COS PUT/GET 和短时效下载票据的基础上，补齐正式应用接入、文件完整性元数据、替换版本语义和数据库失败后的孤立对象清理，并在生产完成真实上传下载闭环。

**Architecture:** `PrivateFileStorage` 继续作为唯一存储适配层，本地驱动用于开发、COS 驱动用于生产。`FileObject` 保存存储位置、SHA-256、状态和替换链；业务归属继续由现有 `ArchiveRecord` 等关联模型表达。上传顺序仍为存储后登记，但登记失败必须 best-effort 删除对象；下载继续先做后端权限/密码/原因校验，再签发 5 分钟后端票据。

**Tech Stack:** Tencent COS XML API, NestJS, Prisma, PostgreSQL, Node crypto/fs, Jest.

---

## 已有能力与禁止重写项

- `services/api/src/file/file.service.ts` 已实现 COS XML PUT/GET、私有本地存储、文件类型/大小校验、后端下载票据、项目角色鉴权和下载审计。
- `services/api/src/file/file.controller.ts` 已实现上传、当前密码确认、下载原因和公开短时效票据路由。
- `services/api/.env.production.example` 已定义 `FILE_STORAGE_DRIVER=cos`、COS 密钥、桶和地域。
- 不引入腾讯云前端 SDK，不让 Web/小程序持有 COS 密钥，不把真实附件写入 Git。
- 第一版不为大文件增加分片/断点续传；现有 100 MiB 上限保持不变。

### Task 1: 给存储适配层增加删除与配置自检

**Files:**

- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify: `services/api/src/file/file.module.ts` only if provider wiring is required

- [ ] **Step 1: 先写失败测试**

新增测试：

- 本地驱动 `delete(objectKey)` 删除对应文件；不存在对象视为幂等成功。
- COS 驱动发送签名 `DELETE` 请求。
- `FILE_STORAGE_DRIVER=cos` 缺少任一 `COS_*` 配置时在启动自检阶段失败。
- 对象 key 越界继续被路径保护拒绝。

```bash
pnpm --filter @jiangkong/api test -- src/file/file.service.spec.ts --runInBand
```

Expected: 当前没有 `delete` 方法，测试失败。

- [ ] **Step 2: 实现统一删除**

在 `PrivateFileStorage` 增加：

```ts
async delete(objectKey: string): Promise<void>
```

- 本地使用 `rm(target, { force: true })`。
- COS 复用签名逻辑，`cosRequest` 支持 `DELETE`。
- COS 返回 204/2xx 为成功，404 作为幂等成功，其余返回中文存储错误。

- [ ] **Step 3: 增加配置自检方法**

增加 `assertConfigured()`：

- local 检查根目录能安全解析。
- cos 检查 `COS_BUCKET`、`COS_REGION`、`COS_SECRET_ID`、`COS_SECRET_KEY` 非空。
- 不输出密钥值。

由文件模块初始化或现有生产 readiness 脚本调用；测试环境不访问真实 COS。

- [ ] **Step 4: 验证并提交**

```bash
pnpm --filter @jiangkong/api test -- src/file/file.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/src/file
git commit -m "feat: 补齐私有存储删除与配置自检"
```

Expected: 全部退出 0。

### Task 2: 补齐文件完整性与替换链元数据

**Files:**

- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/prisma/migrations/20260710170000_file_integrity_metadata/migration.sql`
- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`

- [ ] **Step 1: 写失败测试**

上传 `Buffer.from("private-file")` 时断言 `fileObject.create` 包含：

```ts
contentSha256: createHash("sha256").update(buffer).digest("hex"),
storageStatus: "active",
supersedesFileObjectId: null
```

替换场景断言新文件使用新 objectKey、旧文件仍保留、新文件指向旧文件。

- [ ] **Step 2: 扩展 FileObject**

在 `FileObject` 新增：

```prisma
contentSha256            String?
storageStatus            String   @default("active")
supersedesFileObjectId   String?
supersedesFileObject     FileObject?  @relation("FileObjectReplacement", fields: [supersedesFileObjectId], references: [id])
supersededByFileObjects  FileObject[] @relation("FileObjectReplacement")
```

并为 `supersedesFileObjectId`、`storageStatus` 建索引。字段初期允许旧记录 `contentSha256` 为 null，新上传必须填写。

- [ ] **Step 3: 创建兼容迁移**

迁移只增加 nullable/default 字段、外键和索引，不回填历史文件 hash，也不下载历史 COS 对象。

- [ ] **Step 4: 上传时计算 hash**

`uploadPrivateFile` 在写存储前计算 SHA-256，并写入 `FileObject`。扩展输入为可选 `supersedesFileObjectId`，仅供已完成业务权限校验的内部服务调用；公开上传控制器不接受客户端任意指定替换对象。

- [ ] **Step 5: 下载时验证已有 hash**

`readPrivateFile` 从存储读取后，对 `contentSha256` 非空的新文件重新计算 SHA-256；不一致时写服务端安全日志并拒绝下载。历史 `contentSha256=null` 文件保持兼容，不能自动回填或误判损坏。

- [ ] **Step 6: 验证并提交**

```bash
pnpm --filter @jiangkong/api exec prisma format
pnpm --filter @jiangkong/api exec prisma validate
pnpm --filter @jiangkong/api exec prisma generate
pnpm --filter @jiangkong/api test -- src/file/file.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/prisma services/api/src/file
git commit -m "feat: 记录私有文件完整性与替换链"
```

### Task 3: 清理数据库登记失败产生的孤立对象

**Files:**

- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`

- [ ] **Step 1: 写上传补偿失败测试**

覆盖：

- `storage.write` 成功、Prisma transaction 失败时调用 `storage.delete(objectKey)` 一次。
- delete 成功后向调用方保留原数据库错误。
- delete 失败时不吞掉事实，返回中文“文件登记失败且存储清理未完成”，并包含 objectKey 供服务端日志定位，但不返回 COS Secret。
- Prisma transaction 成功时不删除。

- [ ] **Step 2: 实现补偿清理**

将 `uploadPrivateFile` 当前“创建 `FileObject` 并记录 `file.upload` 审计”的完整 transaction 回调原样包在 `try/catch` 中。`storage.write` 成功后执行 transaction；transaction 抛错时先调用 `storage.delete(objectKey)`，清理成功后重新抛出原错误。

若 delete 也失败，使用 Nest `Logger` 记录 objectKey 和两个错误的安全摘要，再抛出不含密钥的中文错误。

- [ ] **Step 3: 验证并提交**

```bash
pnpm --filter @jiangkong/api test -- src/file/file.service.spec.ts --runInBand
pnpm --filter @jiangkong/api typecheck
pnpm --filter @jiangkong/api lint
git add services/api/src/file
git commit -m "fix: 清理文件登记失败的孤立对象"
```

### Task 4: 固化文件替换的业务入口规则

**Files:**

- Modify: `services/api/src/file/file.service.ts`
- Modify: `services/api/src/file/file.service.spec.ts`
- Modify targeted business services only where replacement already exists:
  - `services/api/src/contract-document/contract-document.service.ts`
  - `services/api/src/contract/contract.service.ts`
  - `services/api/src/settlement/settlement.service.ts`
  - `services/api/src/payment/payment-request.service.ts`

- [ ] **Step 1: 盘点实际替换动作**

用 `rg -n "replace|revision|supersed|upload.*file|fileId"` 确认合同修订稿、合同/结算归档、付款回单哪些动作是新增版本，哪些是首次上传。只改已有替换动作，不新增泛用“任意替换文件”API。

- [ ] **Step 2: 为每个已有替换动作写失败测试**

断言：

- 新上传生成新 objectKey 和新 `FileObject`。
- 新记录 `supersedesFileObjectId` 指向旧文件。
- 旧对象和旧数据库记录不覆盖、不删除。
- 业务关联切到新版本时写业务审计，metadata 含旧/新 fileId。

- [ ] **Step 3: 在业务服务完成授权后调用内部替换**

公开 `POST /files` 仍只负责初次上传。替换必须由合同修订、归档补件或回单更正等业务动作先校验角色、项目、状态和二次确认，再传入旧 fileId。

- [ ] **Step 4: 验证并提交**

运行受影响业务服务的针对性 Jest、API typecheck、lint，全部退出 0 后提交：

```bash
git add services/api/src PROGRESS.md
git commit -m "feat: 保留业务文件替换版本链"
```

### Task 5: 生产 COS 正式接入与验收

**Files:**

- Modify: `services/api/scripts/verify-production-readiness.cjs`
- Modify: `services/api/.env.production.example`
- Modify: `docs/superpowers/runbooks/2026-07-03-production-acceptance-runbook.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: 扩充 readiness 静态检查**

继续只检查配置形态，不访问 COS，不输出密钥。增加：

- `FILE_STORAGE_DRIVER` 只能为 `local` 或 `cos`。
- production 必须为 `cos`。
- bucket 格式、region 格式和上传上限有效。
- `FILE_DOWNLOAD_SECRET` 不得使用默认值且至少 32 字符。

- [ ] **Step 2: 部署前自动验证**

```bash
pnpm --filter @jiangkong/api test -- src/file/file.service.spec.ts src/file/file.controller.spec.ts --runInBand
pnpm --filter @jiangkong/api verify:production-readiness
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @jiangkong/api build
git diff --check
```

Expected: 全部退出 0。

- [ ] **Step 3: 配置生产环境**

在 `/etc/jiangkong/api.env` 设置现有真实私有桶：

- `FILE_STORAGE_DRIVER=cos`
- `COS_BUCKET=jiangkong-prod-files-1438687719`
- `COS_REGION=ap-chengdu`
- 仅服务端可读的最小权限 `COS_SECRET_ID` / `COS_SECRET_KEY`

环境文件权限保持最小化；密钥不得写入仓库、聊天或截图。

- [ ] **Step 4: 真实闭环抽样**

用非敏感测试附件通过 Web 完成：

1. 后端上传。
2. 数据库 `FileObject` 出现 bucket、objectKey、hash、状态和上传人。
3. 绑定一个测试业务对象。
4. 输入当前密码和下载原因取得 5 分钟票据。
5. 下载成功，审计包含 `file.upload`、`file.download.ticket`、`file.download`。
6. 修改 token、actor、expiresAt 或 reason 均失败。
7. COS 原始对象 URL 匿名访问返回 403/AccessDenied。

- [ ] **Step 5: 更新进度并提交**

只记录测试 fileId、审计 action、时间和结论；不记录真实 COS Key 的完整敏感路径或密钥。

```bash
git add services/api/scripts/verify-production-readiness.cjs \
  services/api/.env.production.example \
  docs/superpowers/runbooks/2026-07-03-production-acceptance-runbook.md \
  PROGRESS.md
git commit -m "docs: 记录 COS 正式接入验收"
```

## 验收失败处理

- COS 写入失败：不创建 `FileObject`。
- 数据库登记失败：删除刚写入的 COS 对象；清理失败必须告警并留下 objectKey 定位信息。
- 下载鉴权失败：不读取 COS、不签发票据。
- hash 不匹配：禁止把文件用于归档确认或回单确认，记录安全错误；历史无 hash 文件不自动判定损坏。
- 任何真实业务文件不进入 Git、Google Drive 或个人电脑作为正式档案；本地文件只能作为临时编辑副本。
