# 2026-07-10 阶段 0A 发布基线

## 结论

阶段 0A Task 2 已对指定代码提交完成全量仓库验证，所有要求的验证命令均退出 0。该结果说明本次验证的代码具备发布条件，但“代码可发布”不等于“第一版全部完成”，下文列出的产品与基础设施缺口仍需继续收口。

本次只建立发布基线证据，没有推送 `main`，也没有部署生产环境。

## 验证对象与分支拓扑

- 验证目标 commit：`16c310e67d741bddeac2e928420bdc4835d4d759`
- 工作分支：`codex/phase0a-release-truth-20260710`
- 验证前工作树：干净，无未提交业务文件
- `git fetch --all --prune`：退出 0
- `git rev-list --left-right --count main...HEAD`：`0 1`
- `git merge-base --is-ancestor main HEAD`：退出 0，确认本地 `main` 是验证目标的祖先
- 说明：本地 `main` 已包含聚合提交与 worktree 忽略规则；`origin/main` 按既定安排仍未更新，本次未将该差异视为错误。

验证目标 commit 是运行验证前的 `HEAD`，不包含本基线文档自身的后续提交。

## 全量验证结果

下表时间均为命令开始执行时间，时区为 Asia/Shanghai（UTC+08:00）。

| 执行时间 | 命令 | 实际结果 |
| --- | --- | --- |
| 2026-07-10 16:07:12 | `pnpm --filter @jiangkong/api exec prisma generate` | 退出 0；Prisma schema 读取成功，Prisma Client v5.22.0 生成成功。 |
| 2026-07-10 16:07:25 | `pnpm typecheck` | 退出 0；shared-domain、API、Web Admin 类型检查全部通过。 |
| 2026-07-10 16:07:39 | `pnpm lint` | 退出 0；shared-domain、API、Web Admin lint 全部通过。 |
| 2026-07-10 16:07:53 | `pnpm test` | 退出 0；shared-domain 7/7 个测试文件、56/56 项测试通过；API 62/62 个测试套件、1048/1048 项测试通过；Web Admin 39/39 个测试文件、301/301 项测试通过。 |
| 2026-07-10 16:08:16 | `pnpm --filter @jiangkong/web-admin check:ui` | 退出 0；UI 和业务语言规则自检、规则检查均通过。 |
| 2026-07-10 16:08:33 | `pnpm --filter @jiangkong/api build` | 退出 0；shared-domain 预构建与 NestJS API 构建通过。 |
| 2026-07-10 16:08:46 | `pnpm --filter @jiangkong/web-admin build` | 退出 0；Vite 生产构建通过，转换 3994 个模块，6.02 秒完成。构建输出仍有单个 chunk 大于 500 kB 的非阻断提示，本任务未修改业务代码或构建配置来处理该提示。 |
| 2026-07-10 16:09:05 | `git diff --check` | 退出 0；无空白错误。 |

## 已知未完成范围

- 金额 BigInt 改造。
- COS 正式接入。
- 组织权限管理 UI。
- 合同/结算办公化工作台。

以上范围不改变本次全量验证结论，但仍属于第一版后续收口内容。因此，本基线只能用于证明目标 commit 的代码验证通过，不能据此宣称第一版已全部完成。

## 发布动作边界

- 未推送本地 `main` 或任何远端分支。
- 未修改本地 `main`。
- 未部署生产环境。
- 未修改生产代码、测试代码、依赖、工作流或配置来迁就验证结果。
