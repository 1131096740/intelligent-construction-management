# Task 4 Report: Contract Ledger List Sample

## Outcome

Completed Task 4 by updating `apps/web-admin/src/pages/contracts/ContractListPage.vue` to use the shared list-page sample components and token-based styling.

## What changed

- Replaced the custom page-head/filter shell with `BusinessTableToolbar`.
- Kept the existing ledger actions and preserved the route behavior.
- Switched the ledger table empty state to `EmptyBusinessState` via the TDesign table `#empty` slot.
- Reworked touched styles to use design tokens instead of hardcoded colors, spacing, and radii.
- Left the existing ledger filtering, column toggles, draft tabs, and navigation flows intact.

## Verification

Ran the task brief checks successfully:

- `pnpm --filter @jiangkong/web-admin test -- --run src/pages/contracts/contract-list.config.test.ts src/components/business-table-toolbar.config.test.ts src/components/empty-business-state.config.test.ts`
- `pnpm --filter @jiangkong/web-admin typecheck`
- `pnpm --filter @jiangkong/web-admin lint`
- `pnpm --filter @jiangkong/web-admin check:ui`
- `git diff --check`

Result:

- `39` test files passed, `268` tests passed.
- Typecheck passed.
- Lint passed.
- UI rule check passed.
- Diff check passed.

## Notes

- The workspace had unrelated existing modifications in `.gitignore` and `AGENTS.md`; I left them untouched.
- The first test run needed registry access to refresh packages, so I reran it in CI mode with escalation. After that, the checks were clean.

## Commit

- `4c167c42` - `feat: standardize contract ledger ui sample`

## Task 4 Fix

- 将 `ContractListPage.vue` 里本次触达的摘要条和筛选栅格固定尺寸替换为项目设计令牌；仅新增可复用到结算/付款列表的业务摘要条与列表筛选宽度令牌。
- “新建合同”工具栏按钮和空状态按钮恢复使用既有 `/contracts/new` 路由，保持现有重定向到“合同工作台”的行为不变。
- 查询/重置按钮列去掉固定 `76px`，改为 `max-content` 自适应，页面触达样式不再保留硬编码布局像素值。

### 本次验证

- `CI=true /Users/leoyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm --filter @jiangkong/web-admin test -- --run src/pages/contracts/contract-list.config.test.ts src/components/business-table-toolbar.config.test.ts src/components/empty-business-state.config.test.ts`
  - 结果：通过；`39` 个测试文件通过，`268` 个测试通过。
- `CI=true /Users/leoyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm --filter @jiangkong/web-admin typecheck`
  - 结果：通过。
- `CI=true /Users/leoyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm --filter @jiangkong/web-admin lint`
  - 结果：通过。
- `CI=true /Users/leoyang/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm --filter @jiangkong/web-admin check:ui`
  - 结果：通过。
- `git diff --check`
  - 结果：通过。
