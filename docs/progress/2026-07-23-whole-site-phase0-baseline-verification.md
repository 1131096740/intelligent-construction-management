# 整站受控改造阶段 0：本地基线验证收据

执行日期：2026-07-23（Asia/Shanghai）
基线：`codex/whole-site-phase0`，起点 `07b23f6d`
范围：阶段 0 文档变更后的当前仓库可构建性与已有自动化回归；不连接生产、不迁移数据库、不写业务数据

## 前置与边界

- 当前 worktree 初始没有 `node_modules`。依赖以 `pnpm install --frozen-lockfile` 安装，lockfile 未变化；随后本地执行 `prisma generate`，不连接数据库。
- 第一次 typecheck 的 Prisma 模型类型缺失由未生成 Client 引起；生成后重跑通过，不将前置工具状态计为源代码回归。
- Prisma schema 校验使用无效的本地占位连接串，只解析 schema，不建立数据库连接。
- 以下结论仅证明当前基线的自动化与构建状态，不能替代真实岗位 UAT、生产写链路验证或最终发布验收。

## 结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm run typecheck` | 通过：shared-domain、API、Web 三工作区 |
| Lint | `pnpm run lint` | 通过：shared-domain、API、Web 三工作区 |
| 单元/集成测试 | `pnpm run test` | 通过：shared-domain 108、Web 946、API 4,197；API 15 项预期 skipped |
| Web UI 规则 | `pnpm --filter @jiangkong/web-admin check:ui` | 通过 |
| API 构建 | `pnpm --filter @jiangkong/api build` | 通过 |
| Web 生产构建 | `pnpm --filter @jiangkong/web-admin build` | 通过；存在现有入口 chunk 大于 500KB 的 Vite 警告，未阻断构建 |
| Prisma schema | `DATABASE_URL=<占位值> pnpm --filter @jiangkong/api exec prisma validate` | 通过 |
| Chromium P0 浏览器回归 | `CI=true pnpm --filter @jiangkong/web-admin test:e2e:p0` | 83 项运行完成；报告已作为可再生产物清理 |
| 文档差异 | `git diff --check` | 通过 |

## 浏览器验证解释

P0 Playwright 配置只声明 Chromium。测试运行期间预览服务器曾记录指向未启动本地 API `127.0.0.1:3000` 的代理拒绝；测试使用拦截/fixture 的页面路径仍正常运行完成。因此该收据证明浏览器中的既有结构和交互回归，不宣称完成真实 API、真实权限账号、WebKit/Safari/iOS 或生产 UAT。

阶段 1 的首个只读金丝雀必须新增 WebKit 自动检查，并按阶段 0 总方案覆盖九档视口、200% 缩放与键盘路径；真实岗位 UAT 按用户即将确认的环境策略执行。
