# 五包上线阶段 A：唯一候选基线与范围冻结

> 日期：2026-08-03
>
> 执行阶段：`prd.md` 阶段 A
>
> 结论：已建立唯一五包上线集成候选；本记录不代表 Go-Live Ready

## 1. 本阶段交付

阶段 A 只收口 Git 候选、PRD、任务证据映射和首次上线范围，不安装依赖、不修改业务代码、不连接数据库或生产、不执行浏览器门、不 push、不合并远端 `main`、不部署。

已完成：

1. 从 `4c3ca0f3cde24c2476ddee44e4be413d11f9b3c2` 建立独立分支 `codex/five-package-go-live` 和独立工作树。
2. 可追溯纳入 `prd.md` v1.1 及其 `PROGRESS.md` 记录，候选未直接合并脏的五包源工作树。
3. 逐项审计现有六个工作树，保护用户未提交内容，并给出明确处置。
4. 新建 75 个 Task 的证据映射，区分候选实现、自动化证据、动态门和真实验收，不把历史回执冒充新 SHA 的发布证据。
5. 冻结 `prd.md` 第 6.1 节为首次上线功能边界。

## 2. 候选谱系

| 节点 | SHA | 用途 |
| --- | --- | --- |
| 当时远端/生产代码基线 | `5234fd37bc5c320922f73323af77b20317fcf5f7` | 只用于表达差异起点，不在阶段 A 操作生产 |
| 五包干净审计起点 | `4c3ca0f3cde24c2476ddee44e4be413d11f9b3c2` | 包含结算审批撤回 oracle 修复；新候选的直接祖先 |
| PRD 原始提交 | `b77212ba26c0b365d6a0b5863f2ee73e7d0ab529` | 定义五包完成与上线方案 |
| PRD 关键路径提交 | `57673564337119d8c010433f3cbdad57bd58247a` | 将执行顺序调整为阶段 A–H |
| 候选中 PRD 追溯提交 | `22a0d6a9e2ba3ec50939d030df01bb394d7d493e` | `cherry-pick -x` 保留 `b77212ba…` 来源 |
| 候选中关键路径提交 | `0448959885738fb64519aff87be7ba014429f2f3` | `cherry-pick -x` 保留 `57673564…` 来源；阶段 A 收口文档提交前 HEAD |

阶段 A 文档收口后的最终 SHA 就是包含本记录的提交；下一阶段必须从 `git rev-parse HEAD` 重新取得 40 位 SHA，不得仍使用 `04489598…` 作为阶段 B 候选。

## 3. 工作树保护与处置

| 工作树 | 分支 / HEAD | 审计状态 | 阶段 A 处置 |
| --- | --- | --- | --- |
| `/Users/leoyang/Projects/建工智管` | `main` / `57673564…` | PRD 文档线，当时干净 | 保留为文档来源；不作为五包代码候选 |
| `/Users/leoyang/.codex/worktrees/1a2d/建工智管` | `codex/settlement-approval-withdraw-oracle` / `4c3ca0f3…` | 干净 | 作为不可变建线来源，不在其上继续写入 |
| `/Users/leoyang/.codex/worktrees/e30c/建工智管` | `codex/whole-site-five-packages` / `6838eb17…` | 含暂存、未暂存和未跟踪文件 | 原样保护；禁止 reset/stash/clean；不作为发布工作树 |
| `/Users/leoyang/.codex/worktrees/56d3/建工智管` | detached / `839d0764…` | 含 9 份未跟踪旧审计文档 | 只作历史参考；任何结论必须对新 SHA 重新验证，不整批纳入 |
| `/Users/leoyang/.codex/worktrees/5023adf0-0a37-4255-83be-2a7884f9d19c/建工智管` | `codex/whole-site-foundation` / `07b23f6d…` | 旧基础分支 | 不纳入当前候选；后续清理必须另行审计和授权 |
| `/Users/leoyang/Projects/建工智管/.worktrees/five-package-go-live` | `codex/five-package-go-live` / 本收口提交 | 唯一上线集成线 | 自阶段 B 起作为唯一代码写入主线 |

## 4. 脏源工作树逐项取舍

### 4.1 不移植的暂存结算撤回切片

`e30c` 暂存区的结算审批撤回切片以 `6838eb17…` 为基线。对比表明，`4c3ca0f3…` 是其后续修复，另外包含 `PermissionGuard`、岗位 decorator、路由级 oracle 测试和 controller 的收口变化。因此：

- 不对 `e30c` 的暂存区做二次 cherry-pick 或手工覆盖；
- 不把它误判为“待遗漏的新功能”；
- 以 `4c3ca0f3…` 中的后续 oracle 修复作为唯一权威实现。

### 4.2 用户公安备案改动

`e30c` 的未暂存/未跟踪内容包含：

- `apps/web-admin/src/components/SiteFilingFooter.vue`；
- `apps/web-admin/src/app/site-filing-footer.structure.test.ts`；
- `apps/web-admin/public/images/gongan-beian.png`。

这组改动展示“滇公网安备 53011102001651 号”及相关链接和图标，属于独立产品/合规改动，不是从 `4c3ca0f3…` 建立五包候选的必然一部分。阶段 A 将其标记为**原样保护，待明确确认是否纳入首次上线**，不默认移植。

### 4.3 报告和生成物

- `apps/web-admin/playwright-spot-procurement-receipt-report/index.html`：Playwright 生成物，排除于代码候选。
- `docs/progress/2026-08-02-whole-site-five-package-handoff.md`：只作源工作树保护与交接来源，不复制进候选。
- detached 工作树的 9 份未跟踪审计文档：因基于旧 SHA 且部分结论已被本 PRD 覆盖，仅在后续切片需要时逐份重新验证。

## 5. 首次上线范围冻结

首次上线只包含 `prd.md` 第 6.1 节明确列出的一期业务能力与运维保障。下列内容不在阶段 A 中提前实施：

- OCR、完整 OA、发票大模块、考勤、人事、安全、大屏等一期外模块；
- Task 8 / Release C1、Task 12 旧调用物理退出；
- Task 9 / Release C2 旧表、checkpoint 或业务数据物理清理；
- Task 14 的 M2/M3 小程序代码和生产字段清理；
- 任何未经确认的用户工作树改动。

不在首次上线前执行不等于取消：除一期外模块外，上述五包任务仍必须在观察窗口和独立授权后完成，否则五包整体保持“部分完成”。

## 6. 交给阶段 B 的唯一队列

1. 在本候选工作树使用锁文件执行 frozen dependency install，固定 Node/pnpm/锁文件/缓存回执。
2. 修复 Web Vitest 误收集 Playwright 文件。
3. 修复 API verifier 对偶然存在的 `dist` 的依赖。
4. 增加 PR/push CI 并覆盖标准总门。
5. 统一 workflow、部署入口和服务器脚本的精确 SHA 契约。
6. 区分 liveness/readiness，readiness 覆盖数据库和必要依赖。
7. 移除 `X-Powered-By`，验证 CSP Report-Only，并分诊可达 high 依赖漏洞。

阶段 B 仍须严格使用单一写入主线。只有候选 SHA 冻结后，才能对同一 SHA 并行运行只读验证线。

## 7. 阶段 A 验收

| 验收项 | 结果 |
| --- | --- |
| 候选直接包含 `4c3ca0f3…` | 通过；以 `merge-base --is-ancestor` 复核 |
| PRD 来源可追溯 | 通过；两个候选提交保留 `cherry-pick -x` 来源 |
| 脏源工作树原样保护 | 通过；未 reset/stash/clean/改写 |
| 所有待纳入内容有处置 | 通过；旧切片排除，用户页脚待确认，生成物排除，旧审计只作参考 |
| 75 Task 证据映射 | 通过；见 `2026-08-03-five-package-75-task-evidence-matrix.md` |
| 首次上线范围 | 已冻结为 `prd.md` 第 6.1 节 |
| 文档/Git 静态一致性 | 提交前执行 `git diff --check`、冲突标记检查和状态复核 |

阶段 A 退出后，候选仍只是“可开始阶段 B”，不是“可上生产”。
