# 建工智管 Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> 当前状态（2026-07-03）：本文是 Phase 1 初始历史实施计划，主要链路已经由后续任务完成或细化。后续上线试运行不要直接从本文未勾选项继续执行，应以 `obsidian-current/建工智管_项目状态报告_20260703.md`、`docs/superpowers/specs/2026-07-03-historical-contract-takeover-trial-run-design.md` 和 `PROGRESS.md` 为准。

**Goal:** Build the enterprise Phase 1 core loop: contract versioning, payment terms, approval, seal, archive, settlement, payment request, actual payment, PDF archive, and audit across Web admin and WeChat mini program.

**Architecture:** Use a monorepo with a NestJS + PostgreSQL backend as the business center, Vue 3 + TDesign Web as the primary admin system, and native WeChat mini program + TDesign mini program as the mobile work client. All business invariants live in backend services and database transactions; frontends never access database or object storage directly.

**Tech Stack:** Node.js, pnpm workspaces, NestJS, PostgreSQL, Prisma or TypeORM selected in Task 2, Vue 3, TypeScript, Vite, TDesign Web, native WeChat mini program, TDesign mini program, Tencent COS private bucket, HTTPS deployment on Tencent Cloud Lighthouse.

---

## Source Of Truth

- `/Users/leoyang/Projects/建工智管/AGENTS.md`
- `/Users/leoyang/Projects/建工智管/obsidian-current/建工智管_第一阶段MVP_产品与架构设计.md`
- Obsidian iCloud source: `/Users/leoyang/Library/Mobile Documents/iCloud~md~obsidian/Documents/Ai-Obsidian/建工智管/建工智管_第一阶段MVP_产品与架构设计.md`

Older 6-flow mini program notes and `/Users/leoyang/Projects/公司流程优化` are historical references only.

## Target File Structure

```text
apps/
  web-admin/
    src/
      app/
      pages/
      routes/
      services/
      stores/
      styles/
  miniprogram/
    app.js
    app.json
    app.wxss
    pages/
    services/
    components/
services/
  api/
    src/
      auth/
      organization/
      project/
      contract/
      approval/
      seal/
      settlement/
      payment/
      archive/
      file/
      pdf/
      audit/
      notification/
      system/
packages/
  shared-domain/
    src/
      roles.ts
      statuses.ts
      approval.ts
      money.ts
      ids.ts
  shared-utils/
    src/
docs/
  architecture/
  acceptance/
  superpowers/plans/
```

## Milestone 0: Repository And Workspace Foundation

### Task 0.1: Initialize Monorepo

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md`

- [ ] **Step 1: Create workspace package files**

Create `package.json`:

```json
{
  "name": "jiangkong",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev:api": "pnpm --filter @jiangkong/api dev",
    "dev:web": "pnpm --filter @jiangkong/web-admin dev",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "services/*"
  - "packages/*"
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
.env
.env.*
!.env.example
.DS_Store
coverage/
*.log
apps/miniprogram/miniprogram_npm/
```

Create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
```

- [ ] **Step 2: Verify workspace install**

Run:

```bash
pnpm install
```

Expected: pnpm creates `pnpm-lock.yaml` without package errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore .editorconfig README.md pnpm-lock.yaml
git commit -m "chore: initialize jiangkong workspace"
```

If the repository has not been initialized yet, run `git init` before committing.

### Task 0.2: Create Shared Domain Package

**Files:**
- Create: `packages/shared-domain/package.json`
- Create: `packages/shared-domain/src/roles.ts`
- Create: `packages/shared-domain/src/statuses.ts`
- Create: `packages/shared-domain/src/approval.ts`
- Create: `packages/shared-domain/src/money.ts`
- Create: `packages/shared-domain/src/index.ts`
- Test: `packages/shared-domain/src/statuses.test.ts`

- [ ] **Step 1: Define package metadata**

Create `packages/shared-domain/package.json`:

```json
{
  "name": "@jiangkong/shared-domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Define role constants**

Create `packages/shared-domain/src/roles.ts`:

```ts
export const ROLE_KEYS = [
  "chairman",
  "general_manager",
  "project_manager",
  "contract_director",
  "contract_staff",
  "budget_director",
  "budget_staff",
  "finance_director",
  "finance_staff",
  "material_director",
  "material_staff",
  "engineering_director",
  "engineering_foreman",
  "engineering_tech",
  "comprehensive_director",
  "employee",
  "super_admin"
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const BUSINESS_APPROVAL_ROLES = ROLE_KEYS.filter(
  (role) => role !== "super_admin"
);
```

- [ ] **Step 3: Define status constants**

Create `packages/shared-domain/src/statuses.ts`:

```ts
export const CONTRACT_VERSION_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_seal",
  "in_seal",
  "seal_approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "voided"
] as const;

export type ContractVersionStatus = (typeof CONTRACT_VERSION_STATUSES)[number];

export const SETTLEMENT_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_archive",
  "pending_archive_confirm",
  "effective",
  "partially_paid",
  "paid",
  "voided"
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

export const PAYMENT_REQUEST_STATUSES = [
  "draft",
  "in_approval",
  "approval_rejected",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "voided"
] as const;

export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];
```

- [ ] **Step 4: Define approval constants**

Create `packages/shared-domain/src/approval.ts`:

```ts
export const APPROVAL_NODE_MODES = ["all", "any"] as const;
export type ApprovalNodeMode = (typeof APPROVAL_NODE_MODES)[number];

export const APPROVAL_ACTIONS = [
  "submit",
  "approve",
  "reject_previous",
  "return_to_applicant",
  "withdraw",
  "transfer",
  "delegate",
  "archive_confirm",
  "archive_reject"
] as const;

export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
```

- [ ] **Step 5: Define money helper**

Create `packages/shared-domain/src/money.ts`:

```ts
export type MoneyCents = number;

export function assertNonNegativeMoneyCents(value: number, fieldName: string): MoneyCents {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer amount in cents`);
  }
  return value;
}

export function assertPositiveMoneyCents(value: number, fieldName: string): MoneyCents {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer amount in cents`);
  }
  return value;
}
```

- [ ] **Step 6: Export package API**

Create `packages/shared-domain/src/index.ts`:

```ts
export * from "./roles";
export * from "./statuses";
export * from "./approval";
export * from "./money";
```

- [ ] **Step 7: Add status tests**

Create `packages/shared-domain/src/statuses.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_STATUSES,
  PAYMENT_REQUEST_STATUSES,
  SETTLEMENT_STATUSES
} from "./statuses";

describe("domain statuses", () => {
  it("keeps contract and settlement effectiveness explicit", () => {
    expect(CONTRACT_VERSION_STATUSES).toContain("effective");
    expect(SETTLEMENT_STATUSES).toContain("effective");
  });

  it("keeps payment approval separate from actual payment", () => {
    expect(PAYMENT_REQUEST_STATUSES).toContain("approved_pending_payment");
    expect(PAYMENT_REQUEST_STATUSES).toContain("paid");
  });
});
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm --filter @jiangkong/shared-domain test
```

Expected: 2 tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-domain
git commit -m "feat: add shared domain constants"
```

## Milestone 1: Backend Foundation

### Task 1.1: Scaffold NestJS API Service

**Files:**
- Create: `services/api/package.json`
- Create: `services/api/src/main.ts`
- Create: `services/api/src/app.module.ts`
- Create: `services/api/src/health.controller.ts`
- Create: `services/api/.env.example`
- Test: `services/api/src/health.controller.spec.ts`

- [ ] **Step 1: Create API package**

Create `services/api/package.json`:

```json
{
  "name": "@jiangkong/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "test": "jest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@jiangkong/shared-domain": "workspace:*",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Add NestJS entrypoint**

Create `services/api/src/main.ts`:

```ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.WEB_ORIGIN?.split(",") ?? [],
    credentials: true
  });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
```

Create `services/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

@Module({
  controllers: [HealthController]
})
export class AppModule {}
```

Create `services/api/src/health.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check() {
    return {
      status: "ok",
      service: "jiangkong-api"
    };
  }
}
```

- [ ] **Step 3: Add environment sample**

Create `services/api/.env.example`:

```dotenv
PORT=3000
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://jiangkong:jiangkong@localhost:5432/jiangkong
JWT_ACCESS_SECRET=replace-with-long-random-secret
JWT_REFRESH_SECRET=replace-with-long-random-secret
COS_SECRET_ID=replace-with-tencent-cos-secret-id
COS_SECRET_KEY=replace-with-tencent-cos-secret-key
COS_BUCKET=replace-with-private-bucket
COS_REGION=ap-guangzhou
```

- [ ] **Step 4: Add health test**

Create `services/api/src/health.controller.spec.ts`:

```ts
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("returns service health", () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({
      status: "ok",
      service: "jiangkong-api"
    });
  });
});
```

- [ ] **Step 5: Run test**

Run:

```bash
pnpm --filter @jiangkong/api test
```

Expected: health controller test passes.

- [ ] **Step 6: Commit**

```bash
git add services/api
git commit -m "feat: scaffold api service"
```

### Task 1.2: Choose And Add Database Tooling

**Recommendation:** Use Prisma for Phase 1 because schema iteration, migrations, type-safe queries, and transaction support are straightforward for a small team. If the team strongly prefers TypeORM, document the choice before implementation.

**Files:**
- Modify: `services/api/package.json`
- Create: `services/api/prisma/schema.prisma`
- Create: `services/api/src/database/database.module.ts`
- Create: `services/api/src/database/prisma.service.ts`
- Create: `services/api/docker-compose.yml`

- [ ] **Step 1: Add Prisma dependencies**

Update `services/api/package.json` dependencies:

```json
{
  "dependencies": {
    "@prisma/client": "^5.16.0"
  },
  "devDependencies": {
    "prisma": "^5.16.0"
  }
}
```

Keep existing dependencies and merge these entries.

- [ ] **Step 2: Create local PostgreSQL compose file**

Create `services/api/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    container_name: jiangkong-postgres
    environment:
      POSTGRES_USER: jiangkong
      POSTGRES_PASSWORD: jiangkong
      POSTGRES_DB: jiangkong
    ports:
      - "5432:5432"
    volumes:
      - jiangkong_pgdata:/var/lib/postgresql/data

volumes:
  jiangkong_pgdata:
```

- [ ] **Step 3: Create initial Prisma schema**

Create `services/api/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(uuid())
  phone        String?  @unique
  name         String
  wxOpenid     String?  @unique
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 4: Add Prisma service**

Create `services/api/src/database/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Create `services/api/src/database/database.module.ts`:

```ts
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService]
})
export class DatabaseModule {}
```

- [ ] **Step 5: Import DatabaseModule**

Modify `services/api/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController]
})
export class AppModule {}
```

- [ ] **Step 6: Run local database and migration**

Run:

```bash
cd services/api
docker compose up -d
pnpm prisma migrate dev --name init
```

Expected: PostgreSQL container starts and Prisma creates migration files.

- [ ] **Step 7: Commit**

```bash
git add services/api
git commit -m "feat: add postgres prisma foundation"
```

## Milestone 2: Domain Schema And Invariants

### Task 2.1: Add Organization And Project Schema

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/organization/organization.module.ts`
- Create: `services/api/src/project/project.module.ts`

- [ ] **Step 1: Extend Prisma schema**

Add these models to `services/api/prisma/schema.prisma`:

```prisma
model Department {
  id        String   @id @default(uuid())
  name      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Position {
  id        String   @id @default(uuid())
  key       String   @unique
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model UserPosition {
  id         String   @id @default(uuid())
  userId     String
  positionId String
  projectId  String?
  createdAt  DateTime @default(now())

  @@unique([userId, positionId, projectId])
}

model Project {
  id        String   @id @default(uuid())
  code      String   @unique
  name      String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ProjectMember {
  id        String   @id @default(uuid())
  projectId String
  userId    String
  positionKey String
  createdAt DateTime @default(now())

  @@unique([projectId, userId, positionKey])
}
```

- [ ] **Step 2: Create empty modules**

Create `services/api/src/organization/organization.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class OrganizationModule {}
```

Create `services/api/src/project/project.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class ProjectModule {}
```

- [ ] **Step 3: Import modules**

Modify `services/api/src/app.module.ts` to import `OrganizationModule` and `ProjectModule`.

- [ ] **Step 4: Run migration**

Run:

```bash
cd services/api
pnpm prisma migrate dev --name organization_project
```

Expected: migration succeeds.

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat: add organization project schema"
```

### Task 2.2: Add Contract Version And Payment Terms Schema

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/contract/contract.module.ts`
- Create: `services/api/src/contract/contract-status.service.ts`
- Test: `services/api/src/contract/contract-status.service.spec.ts`

- [ ] **Step 1: Extend Prisma schema**

Add:

```prisma
model Contract {
  id        String   @id @default(uuid())
  projectId String
  code      String   @unique
  name      String
  counterparty String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ContractVersion {
  id        String   @id @default(uuid())
  contractId String
  versionNo Int
  changeType String
  status    String
  amountCents Int
  effectiveAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([contractId, versionNo])
}

model PaymentTermsVersion {
  id                String   @id @default(uuid())
  contractId         String
  contractVersionId  String
  versionNo          Int
  status             String
  originalText       String
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([contractId, versionNo])
}

model PaymentTermsStage {
  id                    String @id @default(uuid())
  paymentTermsVersionId  String
  name                  String
  basis                 String
  ratioBps              Int?
  fixedAmountCents      Int?
  triggerEvent          String
  dueDays               Int
  requiresInvoice       Boolean @default(false)
  allowsEarlyPayment    Boolean @default(false)
  allowsInstallments    Boolean @default(true)
  retentionBps          Int?
  originalText          String
  createdAt             DateTime @default(now())
}

model ContractArchiveFile {
  id                String   @id @default(uuid())
  contractVersionId String
  fileId            String
  uploadedByUserId  String
  confirmedByUserId String?
  confirmedAt       DateTime?
  status            String
  createdAt         DateTime @default(now())
}
```

- [ ] **Step 2: Add contract module**

Create `services/api/src/contract/contract.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ContractStatusService } from "./contract-status.service";

@Module({
  providers: [ContractStatusService],
  exports: [ContractStatusService]
})
export class ContractModule {}
```

- [ ] **Step 3: Add status transition service**

Create `services/api/src/contract/contract-status.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { ContractVersionStatus } from "@jiangkong/shared-domain";

const ALLOWED: Record<ContractVersionStatus, ContractVersionStatus[]> = {
  draft: ["in_approval", "voided"],
  in_approval: ["approval_rejected", "approved_pending_seal"],
  approval_rejected: ["draft", "voided"],
  approved_pending_seal: ["in_seal"],
  in_seal: ["seal_approved_pending_archive"],
  seal_approved_pending_archive: ["pending_archive_confirm"],
  pending_archive_confirm: ["effective", "seal_approved_pending_archive"],
  effective: ["voided"],
  voided: []
};

@Injectable()
export class ContractStatusService {
  canTransition(from: ContractVersionStatus, to: ContractVersionStatus): boolean {
    return ALLOWED[from].includes(to);
  }

  assertTransition(from: ContractVersionStatus, to: ContractVersionStatus) {
    if (!this.canTransition(from, to)) {
      throw new Error(`Invalid contract status transition: ${from} -> ${to}`);
    }
  }
}
```

- [ ] **Step 4: Add transition tests**

Create `services/api/src/contract/contract-status.service.spec.ts`:

```ts
import { ContractStatusService } from "./contract-status.service";

describe("ContractStatusService", () => {
  const service = new ContractStatusService();

  it("allows archive confirmation to make a contract version effective", () => {
    expect(service.canTransition("pending_archive_confirm", "effective")).toBe(true);
  });

  it("does not allow approval to skip seal and archive", () => {
    expect(service.canTransition("approved_pending_seal", "effective")).toBe(false);
  });
});
```

- [ ] **Step 5: Run migration and tests**

Run:

```bash
cd services/api
pnpm prisma migrate dev --name contract_terms
pnpm test -- contract-status.service.spec.ts
```

Expected: migration succeeds and tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/api packages/shared-domain
git commit -m "feat: add contract version terms model"
```

### Task 2.3: Add Settlement And Payment Schema With Money Invariants

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/settlement/settlement.module.ts`
- Create: `services/api/src/payment/payment.module.ts`
- Create: `services/api/src/payment/payment-amount.service.ts`
- Test: `services/api/src/payment/payment-amount.service.spec.ts`

- [ ] **Step 1: Extend Prisma schema**

Add:

```prisma
model Settlement {
  id                    String   @id @default(uuid())
  projectId              String
  contractId             String
  contractVersionId      String
  paymentTermsVersionId  String
  code                  String   @unique
  periodLabel            String
  status                String
  amountCents            Int
  payableAmountCents     Int
  paidAmountCents        Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}

model SettlementArchiveFile {
  id                 String   @id @default(uuid())
  settlementId        String
  fileId             String
  uploadedByUserId   String
  confirmedByUserId  String?
  confirmedAt        DateTime?
  status             String
  createdAt          DateTime @default(now())
}

model PaymentRequest {
  id                    String   @id @default(uuid())
  projectId              String
  settlementId           String
  contractId             String
  contractVersionId      String
  paymentTermsVersionId  String
  code                  String   @unique
  status                String
  requestedAmountCents   Int
  approvedAmountCents    Int?
  paidAmountCents        Int     @default(0)
  dueDate               DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model PaymentExecution {
  id                  String   @id @default(uuid())
  paymentRequestId    String
  settlementId         String
  amountCents          Int
  paidAt              DateTime
  executedByUserId     String
  voucherFileId        String
  createdAt            DateTime @default(now())
}

model FinanceRecord {
  id                String   @id @default(uuid())
  projectId          String
  paymentRequestId   String?
  settlementId       String?
  direction          String
  amountCents        Int
  occurredAt         DateTime
  createdByUserId    String
  createdAt          DateTime @default(now())
}
```

- [ ] **Step 2: Add amount service**

Create `services/api/src/payment/payment-amount.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

export interface PaymentCapacity {
  payableAmountCents: number;
  approvedPendingPaymentCents: number;
  paidAmountCents: number;
}

@Injectable()
export class PaymentAmountService {
  remainingCapacity(input: PaymentCapacity): number {
    return input.payableAmountCents - input.approvedPendingPaymentCents - input.paidAmountCents;
  }

  assertCanRequest(input: PaymentCapacity, requestedAmountCents: number) {
    const remaining = this.remainingCapacity(input);
    if (!Number.isInteger(requestedAmountCents) || requestedAmountCents <= 0) {
      throw new Error("Payment request amount must be positive cents");
    }
    if (requestedAmountCents > remaining) {
      throw new Error(`Payment request exceeds remaining settlement capacity: ${remaining}`);
    }
  }
}
```

- [ ] **Step 3: Add amount tests**

Create `services/api/src/payment/payment-amount.service.spec.ts`:

```ts
import { PaymentAmountService } from "./payment-amount.service";

describe("PaymentAmountService", () => {
  const service = new PaymentAmountService();

  it("allows a request within remaining payable amount", () => {
    expect(() =>
      service.assertCanRequest(
        { payableAmountCents: 100_000, approvedPendingPaymentCents: 20_000, paidAmountCents: 30_000 },
        50_000
      )
    ).not.toThrow();
  });

  it("rejects over-requesting against settlement capacity", () => {
    expect(() =>
      service.assertCanRequest(
        { payableAmountCents: 100_000, approvedPendingPaymentCents: 20_000, paidAmountCents: 30_000 },
        50_001
      )
    ).toThrow("exceeds remaining settlement capacity");
  });
});
```

- [ ] **Step 4: Add modules**

Create `services/api/src/settlement/settlement.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class SettlementModule {}
```

Create `services/api/src/payment/payment.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PaymentAmountService } from "./payment-amount.service";

@Module({
  providers: [PaymentAmountService],
  exports: [PaymentAmountService]
})
export class PaymentModule {}
```

- [ ] **Step 5: Run migration and tests**

Run:

```bash
cd services/api
pnpm prisma migrate dev --name settlement_payment
pnpm test -- payment-amount.service.spec.ts
```

Expected: migration succeeds and tests pass.

- [ ] **Step 6: Commit**

```bash
git add services/api
git commit -m "feat: add settlement payment model"
```

## Milestone 3: Approval, Archive, File, Audit Backend

### Task 3.1: Add Approval Schema And Flow Freezing Service

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/approval/approval.module.ts`
- Create: `services/api/src/approval/approval-freeze.service.ts`
- Test: `services/api/src/approval/approval-freeze.service.spec.ts`

- [ ] **Step 1: Extend schema**

Add:

```prisma
model ApprovalFlow {
  id        String   @id @default(uuid())
  type      String
  name      String
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ApprovalFlowNode {
  id              String @id @default(uuid())
  flowId           String
  sortOrder        Int
  name             String
  mode             String
  roleKeys         String[]
  minAmountCents   Int?
  maxAmountCents   Int?
}

model ApprovalInstance {
  id              String   @id @default(uuid())
  flowType         String
  businessType     String
  businessId       String
  status           String
  currentNodeIndex Int
  frozenNodes      Json
  applicantUserId  String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model ApprovalActionLog {
  id                  String   @id @default(uuid())
  approvalInstanceId  String
  action              String
  actorUserId         String
  comment             String?
  createdAt           DateTime @default(now())
}

model ApprovalDelegation {
  id              String   @id @default(uuid())
  fromUserId       String
  toUserId         String
  startsAt         DateTime
  endsAt           DateTime
  enabled          Boolean @default(true)
  createdAt        DateTime @default(now())
}
```

- [ ] **Step 2: Add freeze service**

Create `services/api/src/approval/approval-freeze.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

export interface FlowNodeInput {
  name: string;
  mode: "all" | "any";
  roleKeys: string[];
  minAmountCents?: number;
  maxAmountCents?: number;
}

export interface FrozenNode {
  name: string;
  mode: "all" | "any";
  roleKeys: string[];
}

@Injectable()
export class ApprovalFreezeService {
  freeze(nodes: FlowNodeInput[], amountCents: number): FrozenNode[] {
    return nodes
      .filter((node) => {
        if (node.minAmountCents !== undefined && amountCents < node.minAmountCents) return false;
        if (node.maxAmountCents !== undefined && amountCents > node.maxAmountCents) return false;
        return true;
      })
      .sort((a, b) => nodes.indexOf(a) - nodes.indexOf(b))
      .map((node) => ({
        name: node.name,
        mode: node.mode,
        roleKeys: [...node.roleKeys]
      }));
  }
}
```

- [ ] **Step 3: Add freeze tests**

Create `services/api/src/approval/approval-freeze.service.spec.ts`:

```ts
import { ApprovalFreezeService } from "./approval-freeze.service";

describe("ApprovalFreezeService", () => {
  const service = new ApprovalFreezeService();

  it("freezes only amount-matched nodes", () => {
    const nodes = service.freeze(
      [
        { name: "项目经理", mode: "any", roleKeys: ["project_manager"] },
        { name: "工程技术部", mode: "any", roleKeys: ["engineering_tech"], minAmountCents: 100_000_000 }
      ],
      99_999_999
    );

    expect(nodes.map((node) => node.name)).toEqual(["项目经理"]);
  });

  it("keeps OR-sign node mode", () => {
    const nodes = service.freeze(
      [{ name: "董事长/总经理", mode: "any", roleKeys: ["chairman", "general_manager"] }],
      1
    );

    expect(nodes[0]).toEqual({
      name: "董事长/总经理",
      mode: "any",
      roleKeys: ["chairman", "general_manager"]
    });
  });
});
```

- [ ] **Step 4: Add module and run tests**

Create `services/api/src/approval/approval.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { ApprovalFreezeService } from "./approval-freeze.service";

@Module({
  providers: [ApprovalFreezeService],
  exports: [ApprovalFreezeService]
})
export class ApprovalModule {}
```

Run:

```bash
cd services/api
pnpm prisma migrate dev --name approval
pnpm test -- approval-freeze.service.spec.ts
```

Expected: migration succeeds and tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/api
git commit -m "feat: add approval flow freezing"
```

### Task 3.2: Add File, Archive, Audit, PDF Module Skeletons

**Files:**
- Modify: `services/api/prisma/schema.prisma`
- Create: `services/api/src/file/file.module.ts`
- Create: `services/api/src/archive/archive.module.ts`
- Create: `services/api/src/audit/audit.module.ts`
- Create: `services/api/src/pdf/pdf.module.ts`

- [ ] **Step 1: Extend schema**

Add:

```prisma
model FileObject {
  id              String   @id @default(uuid())
  bucket          String
  objectKey       String
  originalName    String
  mimeType        String
  sizeBytes       Int
  uploadedByUserId String
  createdAt       DateTime @default(now())
}

model ArchiveRecord {
  id              String   @id @default(uuid())
  businessType     String
  businessId       String
  fileId           String
  departmentScope  String
  createdAt        DateTime @default(now())
}

model PdfDocument {
  id              String   @id @default(uuid())
  businessType     String
  businessId       String
  fileId           String
  templateKey      String
  createdAt        DateTime @default(now())
}

model AuditLog {
  id              String   @id @default(uuid())
  actorUserId      String?
  action           String
  businessType     String?
  businessId       String?
  ipAddress        String?
  userAgent        String?
  metadata         Json?
  createdAt        DateTime @default(now())
}
```

- [ ] **Step 2: Create modules**

Create `services/api/src/file/file.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class FileModule {}
```

Create `services/api/src/archive/archive.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class ArchiveModule {}
```

Create `services/api/src/audit/audit.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class AuditModule {}
```

Create `services/api/src/pdf/pdf.module.ts`:

```ts
import { Module } from "@nestjs/common";

@Module({})
export class PdfModule {}
```

- [ ] **Step 3: Run migration**

Run:

```bash
cd services/api
pnpm prisma migrate dev --name file_archive_audit_pdf
```

Expected: migration succeeds.

- [ ] **Step 4: Commit**

```bash
git add services/api
git commit -m "feat: add archive file audit pdf schema"
```

## Milestone 4: Backend Use Cases

### Task 4.1: Implement Contract Creation Use Case

**Files:**
- Create: `services/api/src/contract/dto/create-contract.dto.ts`
- Create: `services/api/src/contract/contract.service.ts`
- Create: `services/api/src/contract/contract.controller.ts`
- Modify: `services/api/src/contract/contract.module.ts`
- Test: `services/api/src/contract/contract.service.spec.ts`

- [ ] **Step 1: Add DTO**

Create `services/api/src/contract/dto/create-contract.dto.ts`:

```ts
export interface CreatePaymentTermsStageDto {
  name: string;
  basis: "contract_amount" | "current_settlement" | "cumulative_settlement" | "fixed_amount" | "manual_amount";
  ratioBps?: number;
  fixedAmountCents?: number;
  triggerEvent: string;
  dueDays: number;
  requiresInvoice: boolean;
  allowsEarlyPayment: boolean;
  allowsInstallments: boolean;
  retentionBps?: number;
  originalText: string;
}

export interface CreateContractDto {
  projectId: string;
  code: string;
  name: string;
  counterparty: string;
  amountCents: number;
  paymentTermsOriginalText: string;
  paymentStages: CreatePaymentTermsStageDto[];
}
```

- [ ] **Step 2: Add service behavior**

Create `services/api/src/contract/contract.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { CreateContractDto } from "./dto/create-contract.dto";

@Injectable()
export class ContractService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(input: CreateContractDto) {
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          projectId: input.projectId,
          code: input.code,
          name: input.name,
          counterparty: input.counterparty
        }
      });

      const version = await tx.contractVersion.create({
        data: {
          contractId: contract.id,
          versionNo: 1,
          changeType: "original",
          status: "draft",
          amountCents: input.amountCents
        }
      });

      const terms = await tx.paymentTermsVersion.create({
        data: {
          contractId: contract.id,
          contractVersionId: version.id,
          versionNo: 1,
          status: "draft",
          originalText: input.paymentTermsOriginalText
        }
      });

      await tx.paymentTermsStage.createMany({
        data: input.paymentStages.map((stage) => ({
          paymentTermsVersionId: terms.id,
          name: stage.name,
          basis: stage.basis,
          ratioBps: stage.ratioBps,
          fixedAmountCents: stage.fixedAmountCents,
          triggerEvent: stage.triggerEvent,
          dueDays: stage.dueDays,
          requiresInvoice: stage.requiresInvoice,
          allowsEarlyPayment: stage.allowsEarlyPayment,
          allowsInstallments: stage.allowsInstallments,
          retentionBps: stage.retentionBps,
          originalText: stage.originalText
        }))
      });

      return { contract, version, terms };
    });
  }
}
```

- [ ] **Step 3: Add service unit test**

Create `services/api/src/contract/contract.service.spec.ts` with a mocked Prisma transaction that asserts `contractVersion.status` is `draft` and first `PaymentTermsVersion.versionNo` is `1`.

Use this minimum assertion:

```ts
expect(result.version.versionNo).toBe(1);
expect(result.version.status).toBe("draft");
expect(result.terms.versionNo).toBe(1);
```

- [ ] **Step 4: Wire controller**

Create `services/api/src/contract/contract.controller.ts`:

```ts
import { Body, Controller, Post } from "@nestjs/common";
import { ContractService } from "./contract.service";
import { CreateContractDto } from "./dto/create-contract.dto";

@Controller("contracts")
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  @Post()
  create(@Body() body: CreateContractDto) {
    return this.contracts.createDraft(body);
  }
}
```

Modify `contract.module.ts` to provide `ContractService` and `ContractController`.

- [ ] **Step 5: Run tests**

Run:

```bash
cd services/api
pnpm test -- contract.service.spec.ts
```

Expected: contract draft creation test passes.

- [ ] **Step 6: Commit**

```bash
git add services/api/src/contract
git commit -m "feat: create draft contract with payment terms"
```

### Task 4.2: Implement Settlement Creation Guard

**Files:**
- Create: `services/api/src/settlement/settlement.service.ts`
- Test: `services/api/src/settlement/settlement.service.spec.ts`

- [ ] **Step 1: Add service rule**

Create `services/api/src/settlement/settlement.service.ts`:

```ts
import { Injectable } from "@nestjs/common";

@Injectable()
export class SettlementService {
  assertContractVersionEffective(status: string) {
    if (status !== "effective") {
      throw new Error("Cannot create settlement from a non-effective contract version");
    }
  }
}
```

- [ ] **Step 2: Add test**

Create `services/api/src/settlement/settlement.service.spec.ts`:

```ts
import { SettlementService } from "./settlement.service";

describe("SettlementService", () => {
  const service = new SettlementService();

  it("rejects settlement creation before contract version is effective", () => {
    expect(() => service.assertContractVersionEffective("pending_archive_confirm")).toThrow(
      "Cannot create settlement"
    );
  });

  it("allows settlement creation from effective contract version", () => {
    expect(() => service.assertContractVersionEffective("effective")).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests**

Run:

```bash
cd services/api
pnpm test -- settlement.service.spec.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/settlement
git commit -m "feat: guard settlement creation by contract effectiveness"
```

### Task 4.3: Implement Payment Request Guard

**Files:**
- Create: `services/api/src/payment/payment-request.service.ts`
- Test: `services/api/src/payment/payment-request.service.spec.ts`

- [ ] **Step 1: Add service rule**

Create `services/api/src/payment/payment-request.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PaymentAmountService, PaymentCapacity } from "./payment-amount.service";

@Injectable()
export class PaymentRequestService {
  constructor(private readonly amount: PaymentAmountService) {}

  assertSettlementEffective(status: string) {
    if (status !== "effective" && status !== "partially_paid") {
      throw new Error("Cannot create payment request from a non-effective settlement");
    }
  }

  assertRequestAllowed(status: string, capacity: PaymentCapacity, requestedAmountCents: number) {
    this.assertSettlementEffective(status);
    this.amount.assertCanRequest(capacity, requestedAmountCents);
  }
}
```

- [ ] **Step 2: Add test**

Create `services/api/src/payment/payment-request.service.spec.ts`:

```ts
import { PaymentAmountService } from "./payment-amount.service";
import { PaymentRequestService } from "./payment-request.service";

describe("PaymentRequestService", () => {
  const service = new PaymentRequestService(new PaymentAmountService());

  it("rejects payment request before settlement is effective", () => {
    expect(() =>
      service.assertRequestAllowed(
        "approved_pending_archive",
        { payableAmountCents: 100_000, approvedPendingPaymentCents: 0, paidAmountCents: 0 },
        10_000
      )
    ).toThrow("non-effective settlement");
  });

  it("allows partial payment request within settlement capacity", () => {
    expect(() =>
      service.assertRequestAllowed(
        "effective",
        { payableAmountCents: 100_000, approvedPendingPaymentCents: 20_000, paidAmountCents: 20_000 },
        60_000
      )
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: Run tests**

Run:

```bash
cd services/api
pnpm test -- payment-request.service.spec.ts
```

Expected: tests pass.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/payment
git commit -m "feat: guard payment requests by settlement capacity"
```

## Milestone 5: Web Admin Foundation

### Task 5.1: Scaffold Vue 3 Web Admin

**Files:**
- Create: `apps/web-admin/package.json`
- Create: `apps/web-admin/index.html`
- Create: `apps/web-admin/src/main.ts`
- Create: `apps/web-admin/src/app/App.vue`
- Create: `apps/web-admin/src/routes/index.ts`

- [x] **Step 1: Add package metadata**

Create `apps/web-admin/package.json`:

```json
{
  "name": "@jiangkong/web-admin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "vue-tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint src --ext .ts,.vue"
  },
  "dependencies": {
    "@jiangkong/shared-domain": "workspace:*",
    "tdesign-vue-next": "^1.10.0",
    "vue": "^3.4.0",
    "vue-router": "^4.4.0",
    "pinia": "^2.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vue-tsc": "^2.0.0",
    "vitest": "^1.6.0"
  }
}
```

- [x] **Step 2: Add app files**

Create `apps/web-admin/index.html`:

```html
<div id="app"></div>
<script type="module" src="/src/main.ts"></script>
```

Create `apps/web-admin/src/main.ts`:

```ts
import { createApp } from "vue";
import TDesign from "tdesign-vue-next";
import "tdesign-vue-next/es/style/index.css";
import App from "./app/App.vue";
import { router } from "./routes";

createApp(App).use(router).use(TDesign).mount("#app");
```

Create `apps/web-admin/src/app/App.vue`:

```vue
<template>
  <router-view />
</template>
```

Create `apps/web-admin/src/routes/index.ts`:

```ts
import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      component: () => import("../pages/workbench/WorkbenchPage.vue")
    }
  ]
});
```

- [x] **Step 3: Add workbench placeholder page**

Create `apps/web-admin/src/pages/workbench/WorkbenchPage.vue`:

```vue
<template>
  <main class="page">
    <h1>建工智管</h1>
    <p>第一阶段 MVP：合同、结算、付款闭环。</p>
  </main>
</template>

<style scoped>
.page {
  padding: 24px;
}
</style>
```

- [x] **Step 4: Run dev build**

Run:

```bash
pnpm --filter @jiangkong/web-admin build
```

Expected: Vite build succeeds.

- [x] **Step 5: Commit**

```bash
git add apps/web-admin
git commit -m "feat: scaffold web admin"
```

### Task 5.2: Add Web Admin Enterprise Navigation

**Files:**
- Create: `apps/web-admin/src/app/AdminLayout.vue`
- Modify: `apps/web-admin/src/routes/index.ts`
- Create pages under `apps/web-admin/src/pages/*`

- [x] **Step 1: Create layout**

Create `apps/web-admin/src/app/AdminLayout.vue`:

```vue
<template>
  <t-layout class="admin-shell">
    <t-aside width="232px">
      <div class="brand">建工智管</div>
      <t-menu theme="light" :value="$route.path">
        <t-menu-item value="/contracts" @click="$router.push('/contracts')">合同台账</t-menu-item>
        <t-menu-item value="/settlements" @click="$router.push('/settlements')">结算管理</t-menu-item>
        <t-menu-item value="/payments" @click="$router.push('/payments')">付款管理</t-menu-item>
        <t-menu-item value="/archives" @click="$router.push('/archives')">资料库</t-menu-item>
        <t-menu-item value="/audit" @click="$router.push('/audit')">审计日志</t-menu-item>
      </t-menu>
    </t-aside>
    <t-layout>
      <t-header class="header">审批与合同付款闭环 MVP</t-header>
      <t-content class="content">
        <router-view />
      </t-content>
    </t-layout>
  </t-layout>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
}
.brand {
  height: 56px;
  display: flex;
  align-items: center;
  padding-left: 20px;
  font-weight: 700;
}
.header {
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid #e5e7eb;
}
.content {
  padding: 20px;
  background: #f5f7fa;
}
</style>
```

- [x] **Step 2: Add module pages**

Create simple pages:

```text
apps/web-admin/src/pages/contracts/ContractListPage.vue
apps/web-admin/src/pages/settlements/SettlementListPage.vue
apps/web-admin/src/pages/payments/PaymentListPage.vue
apps/web-admin/src/pages/archives/ArchiveListPage.vue
apps/web-admin/src/pages/audit/AuditLogPage.vue
```

Each page starts with a `t-card` title and a `t-table` placeholder with no mock production data.

- [x] **Step 3: Wire routes**

Modify routes so `/` redirects to `/contracts`, all module pages render inside `AdminLayout`.

- [x] **Step 4: Build**

Run:

```bash
pnpm --filter @jiangkong/web-admin build
```

Expected: build succeeds.

- [x] **Step 5: Commit**

```bash
git add apps/web-admin
git commit -m "feat: add web admin enterprise shell"
```

## Milestone 6: Mini Program Foundation

### Task 6.1: Scaffold Mini Program Structure

**Files:**
- Create: `apps/miniprogram/project.config.json`
- Create: `apps/miniprogram/app.json`
- Create: `apps/miniprogram/app.js`
- Create: `apps/miniprogram/app.wxss`
- Create: `apps/miniprogram/pages/workbench/*`
- Create: `apps/miniprogram/pages/approvals/*`
- Create: `apps/miniprogram/pages/approval-detail/*`
- Create: `apps/miniprogram/pages/messages/*`
- Create: `apps/miniprogram/pages/profile/*`

- [ ] **Step 1: Create app config**

Create `apps/miniprogram/app.json`:

```json
{
  "pages": [
    "pages/workbench/workbench",
    "pages/approvals/approvals",
    "pages/approval-detail/approval-detail",
    "pages/messages/messages",
    "pages/profile/profile"
  ],
  "window": {
    "navigationBarTitleText": "建工智管",
    "navigationBarBackgroundColor": "#f8fafc",
    "navigationBarTextStyle": "black"
  },
  "tabBar": {
    "color": "#6b7280",
    "selectedColor": "#0052d9",
    "backgroundColor": "#ffffff",
    "list": [
      { "pagePath": "pages/workbench/workbench", "text": "工作台" },
      { "pagePath": "pages/approvals/approvals", "text": "审批" },
      { "pagePath": "pages/messages/messages", "text": "消息" },
      { "pagePath": "pages/profile/profile", "text": "我的" }
    ]
  },
  "style": "v2"
}
```

- [ ] **Step 2: Create app files**

Create `apps/miniprogram/app.js`:

```js
App({
  globalData: {
    apiBaseUrl: ""
  }
});
```

Create `apps/miniprogram/app.wxss`:

```css
page {
  background: #f5f7fa;
  color: #1f2937;
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
}
```

- [ ] **Step 3: Create workbench page**

Create `apps/miniprogram/pages/workbench/workbench.json`:

```json
{
  "navigationBarTitleText": "工作台"
}
```

Create `apps/miniprogram/pages/workbench/workbench.wxml`:

```xml
<view class="page">
  <view class="title">建工智管</view>
  <view class="subtitle">合同、结算、付款移动工作端</view>
</view>
```

Create `apps/miniprogram/pages/workbench/workbench.wxss`:

```css
.page {
  padding: 32rpx;
}
.title {
  font-size: 40rpx;
  font-weight: 700;
}
.subtitle {
  margin-top: 12rpx;
  color: #6b7280;
}
```

Create `apps/miniprogram/pages/workbench/workbench.js`:

```js
Page({});
```

- [ ] **Step 4: Create remaining pages**

For each of `approvals`, `approval-detail`, `messages`, `profile`, create `.json`, `.wxml`, `.wxss`, `.js` files with page-specific title and empty state. Do not add mock business records.

- [ ] **Step 5: Verify in WeChat DevTools**

Open `apps/miniprogram` in WeChat DevTools.

Expected: app compiles and four tabs load.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram
git commit -m "feat: scaffold mini program mobile client"
```

## Milestone 7: End-To-End MVP Slice

### Task 7.1: Implement Contract To Effective Slice

**Goal:** A contract can be created with payment terms, approved through the required flow, sealed, archived, and marked effective.

**Backend endpoints:**
- `POST /contracts`
- `POST /contracts/:contractVersionId/submit-approval`
- `POST /approvals/:id/actions`
- `POST /contracts/:contractVersionId/archive-files`
- `POST /contracts/:contractVersionId/archive-confirm`

**Web pages:**
- Contract list.
- Contract detail.
- Payment terms editor.
- Archive confirmation panel.

**Mini program pages:**
- Approval list.
- Approval detail.

- [ ] **Step 1: Write backend integration test**

Create a test that asserts a contract cannot reach `effective` before archive confirmation.

Expected chain:

```text
draft -> in_approval -> approved_pending_seal -> in_seal -> seal_approved_pending_archive -> pending_archive_confirm -> effective
```

- [ ] **Step 2: Implement minimal endpoints**

Implement endpoints with backend status transition checks.

- [ ] **Step 3: Implement Web list and detail using API**

The contract detail must show:

- Contract version status.
- Payment terms version.
- Approval timeline.
- Archive file status.

- [ ] **Step 4: Implement mini program approval detail**

The approval detail must show:

- Business title.
- Current node.
- Attachment list.
- Approve/reject actions when permitted.

- [ ] **Step 5: Run E2E manually**

Create one test contract, approve it, complete seal, upload archive, confirm archive.

Expected: contract version becomes `effective`.

- [ ] **Step 6: Commit**

```bash
git add services/api apps/web-admin apps/miniprogram
git commit -m "feat: implement contract effectiveness slice"
```

### Task 7.2: Implement Settlement To Effective Slice

**Goal:** A settlement can only be created from an effective contract version and must be archived before becoming payable.

**Backend endpoints:**
- `POST /settlements`
- `POST /settlements/:id/submit-approval`
- `POST /settlements/:id/archive-files`
- `POST /settlements/:id/archive-confirm`

- [ ] **Step 1: Write failing tests**

Tests:

- Reject settlement creation from non-effective contract version.
- Reject payment request creation from settlement before archive confirmation.
- Allow settlement creation from effective contract version.

- [ ] **Step 2: Implement backend use case**

Use `contract_version_id` and `payment_terms_version_id` from the effective contract version selected at settlement creation time.

- [ ] **Step 3: Implement Web settlement pages**

Settlement form must select an effective contract version only.

- [ ] **Step 4: Run manual E2E**

Use an effective contract to create settlement, approve it, upload signed settlement file, confirm archive.

Expected: settlement status becomes `effective`.

- [ ] **Step 5: Commit**

```bash
git add services/api apps/web-admin
git commit -m "feat: implement settlement effectiveness slice"
```

### Task 7.3: Implement Payment Approval And Actual Payment Slice

**Goal:** A payment request can only be created from an effective settlement, approval does not equal payment, and finance must record actual payment with voucher.

**Backend endpoints:**
- `POST /payments`
- `POST /payments/:id/submit-approval`
- `POST /payments/:id/execute`

- [ ] **Step 1: Write failing tests**

Tests:

- Reject payment request from non-effective settlement.
- Reject payment request over remaining settlement payable amount.
- Approval sets status to `approved_pending_payment`.
- Actual payment creates `PaymentExecution` and `FinanceRecord`.

- [ ] **Step 2: Implement backend transaction**

In one transaction:

- Lock or re-read settlement payment totals.
- Validate remaining capacity.
- Create payment execution.
- Update payment request paid amount.
- Update settlement paid amount.
- Create finance record.
- Create audit log.

- [ ] **Step 3: Implement Web payment pages**

Pages:

- Payment request form from settlement.
- Pending payment list.
- Actual payment registration form.

- [ ] **Step 4: Implement mini program payment approval**

Payment approval detail must show:

- Contract.
- Settlement.
- Payment terms version.
- Requested amount.
- Remaining payable capacity.

- [ ] **Step 5: Manual E2E**

From an effective settlement, create a payment request, approve it, verify pending payment, execute partial payment, execute remaining payment.

Expected:

- First execution sets `partially_paid`.
- Final execution sets `paid`.
- Finance records exist.

- [ ] **Step 6: Commit**

```bash
git add services/api apps/web-admin apps/miniprogram
git commit -m "feat: implement payment execution slice"
```

## Milestone 8: Security, Files, PDF, Audit

### Task 8.1: Private File Upload And Download

**Goal:** Sensitive files live in private COS storage and downloads require backend permission checks.

**Files:**
- Implement `FileModule`
- Implement short-lived URL endpoint
- Add audit log on download

- [ ] **Step 1: Write tests for permission check**

Test that a user without business permission cannot obtain a download URL.

- [ ] **Step 2: Implement upload metadata creation**

Record bucket, object key, original name, MIME type, size, uploader.

- [ ] **Step 3: Implement download URL endpoint**

Endpoint returns a short-lived COS URL only after permission passes.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/file services/api/src/audit
git commit -m "feat: add private file access"
```

### Task 8.2: PDF Archive Generation

**Goal:** Generate PDF records for approved payment and archive events.

- [ ] **Step 1: Select PDF library**

Use server-side HTML-to-PDF or a Node PDF library. Record the choice in `docs/architecture/pdf-generation.md`.

- [ ] **Step 2: Implement payment approval PDF template**

Template includes:

- Project.
- Contract.
- Settlement.
- Payment request.
- Approval history.
- Signatures or approver names.
- Timestamps.

- [ ] **Step 3: Store generated PDF as private file**

Create `PdfDocument` row and `ArchiveRecord`.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/pdf docs/architecture/pdf-generation.md
git commit -m "feat: generate payment approval pdf"
```

### Task 8.3: Audit Log Coverage

**Goal:** Every sensitive action in AGENTS.md writes an audit log.

- [ ] **Step 1: Add audit service**

Implement `AuditService.record({ actorUserId, action, businessType, businessId, metadata })`.

- [ ] **Step 2: Add audit calls**

Add audit calls to:

- Login.
- Approval action.
- Archive upload.
- Archive confirmation.
- Payment execution.
- Voucher upload.
- Sensitive file download.
- Permission change.
- Document voiding.

- [ ] **Step 3: Add Web audit page**

Show audit rows with filters:

- Actor.
- Action.
- Business type.
- Date range.

- [ ] **Step 4: Commit**

```bash
git add services/api/src/audit apps/web-admin/src/pages/audit
git commit -m "feat: add audit log coverage"
```

## Milestone 9: Deployment Preparation

### Task 9.1: Add Deployment Docs And Environment Checks

**Files:**
- Create: `docs/architecture/deployment.md`
- Create: `services/api/scripts/check-env.ts`
- Create: `services/api/.env.production.example`

- [ ] **Step 1: Write deployment doc**

Create `docs/architecture/deployment.md` covering:

- Tencent Cloud Lighthouse.
- Nginx HTTPS.
- PostgreSQL private local access.
- COS private bucket.
- Daily database backups.
- Secret handling.
- Mini program legal request domain.

- [ ] **Step 2: Add production env example**

Create `services/api/.env.production.example` with all required keys and safe placeholder values.

- [ ] **Step 3: Add env check script**

Script verifies required env names exist but never prints secret values.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture services/api/scripts services/api/.env.production.example
git commit -m "docs: add deployment security checklist"
```

## Milestone 10: Acceptance Tests

### Task 10.1: Write Phase 1 Acceptance Checklist

**Files:**
- Create: `docs/acceptance/phase1-mvp-acceptance.md`

- [ ] **Step 1: Create acceptance doc**

Include these required checks:

1. Contract staff creates contract with multi-stage payment terms.
2. Contract director and budget director countersign.
3. Chairman or general manager OR-sign completes contract final approval.
4. Contract approval triggers seal flow.
5. Contract staff uploads signed contract and contract director confirms archive.
6. Non-effective contract cannot create settlement.
7. Settlement approval does not include chairman/general manager.
8. Settlement archive confirmation makes settlement effective.
9. Non-effective settlement cannot create payment request.
10. Payment request cannot exceed remaining payable capacity.
11. Chairman or general manager OR-sign completes payment approval.
12. Payment approval creates `approved_pending_payment`, not `paid`.
13. Finance executes partial payment with voucher.
14. Finance executes final payment with voucher.
15. Settlement and payment history trace original contract version and terms version.
16. Sensitive file URL cannot be fetched by unauthorized user.
17. Sensitive file download writes audit log.

- [ ] **Step 2: Commit**

```bash
git add docs/acceptance/phase1-mvp-acceptance.md
git commit -m "docs: add phase1 mvp acceptance checklist"
```

## Execution Order

Implement in this order:

1. Milestone 0: repository and shared domain.
2. Milestone 1: backend foundation and database tooling.
3. Milestone 2: domain schema and invariant services.
4. Milestone 3: approval, archive, file, audit foundations.
5. Milestone 4: backend use cases.
6. Milestone 5: Web admin shell.
7. Milestone 6: mini program shell.
8. Milestone 7: end-to-end business slices.
9. Milestone 8: security, files, PDF, audit.
10. Milestone 9: deployment preparation.
11. Milestone 10: acceptance checklist and manual verification.

## Self-Review Notes

- The plan keeps Phase 1 focused on approval, contract, settlement, payment, seal, archive, PDF, and audit.
- It explicitly excludes old 6-flow mini-program assumptions.
- Backend tests cover the most dangerous invariants: status transitions, payment capacity, settlement effectiveness, and approval freezing.
- Exact deployment credentials and Tencent Cloud resource IDs are intentionally not specified; they must be supplied as environment variables and never committed.
