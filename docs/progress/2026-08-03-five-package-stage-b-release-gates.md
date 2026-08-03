# 五包阶段 B：发布门禁基础设施执行记录

日期：2026-08-03

分支：`codex/five-package-go-live`

阶段 A 基线：`de025e9a1e0a1f60f3973b7973b6578ef94635be`

状态：本地实现与验证完成；远端同 SHA CI 和生产等价 CSP 观察待完成；非 Go-Live Ready

## 1. 本阶段边界

本阶段只修复可重复发布所需的依赖、测试入口、CI、部署 SHA、健康检查、安全响应头及已明确纳入上线范围的公安备案页脚。未连接生产，未启动数据库或 Docker，未 push、合并、部署、迁移或修改业务数据。

## 2. 已完成内容

### 2.1 依赖与可重复安装

- 本地工具链：Node `v22.23.0`、pnpm `9.15.9`。
- `pnpm-lock.yaml` 最终 SHA-256：`984c26d79e617803a42d10c12091c2ffe3978770f3a200ba00d2421f194c5edb`。
- `CI=true pnpm install --frozen-lockfile` 与 Prisma Client generate 均退出 0。
- 生产依赖审计由 11 项（5 high、5 moderate、1 low）降为 4 项 moderate；`pnpm audit --prod --audit-level high` 退出 0。
- 通过精确 override 修复当前依赖树中可无破坏升级的 `brace-expansion`、`body-parser`、`multer`、`postcss` 和 `qs`。

剩余 moderate 已做当前代码可达性分诊：

1. `file-type@20.4.1` 两项风险位于依赖链中，修复版本要求主版本升级；当前业务源码未使用 `FileTypeValidator`、`ParseFilePipe` 或 `file-type` 检测 API。后续升级 Nest 主版本时一并消除。参考 [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) 与 [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v)。
2. Nest SSE 风险要求应用把攻击者可控内容桥接到 SSE 消息的 `id/type`；当前 API 没有 `@Sse` 路由。后续 Nest 主版本升级消除。参考 [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75)。
3. `uuid@8.3.2` 经 ExcelJS 间接引入；公告影响带外部输出缓冲区的 v3/v5/v6 调用，ExcelJS 当前调用为 v4，项目未直接调用受影响 API。后续 ExcelJS/uuid 升级消除。参考 [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)。

以上结论只证明当前源码路径未发现可达用法，不等同于永久豁免。新增 SSE、文件类型检测或 UUID 低版本 API 时必须重新评估。

### 2.2 测试入口与 CI

- Web Vitest 显式只收集 `src/**/*.test.ts` 和 `src/**/*.spec.ts`，不再收集 Playwright E2E。
- API `pretest` 显式构建 shared-domain 并生成 Prisma Client；结算撤回并发 verifier 将运行时服务延迟加载，纯 runner 测试不依赖残留 `dist`。
- 新增 PR 与 `main` push CI，包含 frozen install、Prisma、high 漏洞审计、全量 test/typecheck/lint/build、Web E2E typecheck、`check:ui`、业务错误、运维安全自测及六份普通能力/清单检查。
- 生产部署 workflow 同样执行 high 漏洞审计。

### 2.3 精确 SHA 与运行状态

- GitHub workflow 与服务器部署脚本统一使用唯一 `TARGET_SHA`；脚本要求 40 位 SHA，并在构建、迁移和服务重启前验证 checkout HEAD 精确一致。
- `/health` 保持不访问数据库的 liveness。
- 新增 `/health/readiness`，成功时证明数据库查询可用；失败只返回安全的 503 与 `database: unavailable`，不泄露底层错误。
- 部署后先验证 liveness，再验证 readiness；恢复旧运行时时只要求旧版本已有的 liveness，以兼容首次引入 readiness 的回退。
- 本地运行态负向验证：`/health` 返回 200；使用不可达的本地测试数据库时 `/health/readiness` 返回 503 安全响应；两个响应均无 `X-Powered-By`。

### 2.4 安全响应头

- API 启动即禁用 Express `x-powered-by`，并有聚焦单测。
- Nginx 示例新增 CSP Report-Only，覆盖默认来源、frame、form、script、style、COS 图片、字体、连接和 worker/blob 边界。
- 运维自测锁定 Report-Only 存在且当前不误启用强制 CSP。
- 尚未在生产等价 Nginx 中观察实际页面、CSP 报告和第三方资源，因此只能算配置与本地静态门完成。

### 2.5 公安备案页脚

- 页脚保留 ICP 链接，新增公安备案号 `滇公网安备53011102001651号`、公安备案查询链接和 36×40 RGBA 图标。
- 结构测试验证备案号、链接、图标和安全的外链属性。
- Web production build 经浏览器验证：桌面 `1280×720` 与移动 `390×844` 均显示两个备案链接；图标成功加载；页脚可换行且无横向溢出；控制台 0 error / 0 warning。

## 3. 本地门禁回执

以下命令均退出 0：

- frozen install、Prisma generate、生产依赖 high audit；
- Shared/API/Web 全量测试；其中 Shared 150 项、Web 1749 项，API 全量 Jest 通过；
- 根 typecheck、Web E2E typecheck、根 lint；
- API/Web production build、Web `check:ui`；
- API 业务错误检查与 self-test；
- go-live 运维安全 self-test、相关 shell `bash -n`、workflow YAML 解析；
- Nest 路由、route usage、Web API usage、page action、整站能力矩阵和合同工作台能力矩阵普通检查。

清单结果：399 条 Nest 路由、0 条未分类路由；整站能力矩阵仍为 blocked，包含 310 个历史 blocker。新增 readiness 没有引入新的业务 blocker；310 项必须在阶段 C 按 P0/P1/P2 可达性和共享根因分级，不能把普通检查退出 0 误写成发布 ready。

## 4. 尚未满足的阶段 B 退出条件

1. 候选尚未 push，因此新 CI 还没有绑定本提交 SHA 的远端回执。
2. CSP Report-Only 尚未在生产等价 Nginx、真实构建和浏览器链路中观察。
3. 当前提交完成后才形成新的精确候选 SHA；所有后续动态和发布证据必须绑定该 SHA，不得复用阶段 A 或旧工作树回执。

在以上两项外部门完成前，阶段 B 保持“本地实现完成、退出条件未全部满足”，不得进入生产发布，也不得标记 Go-Live Ready。下一开发阶段是阶段 C：对 310 项历史 blocker 进行 P0/P1/P2 可达性分级，形成唯一 P0 修复队列和 P1/P2 处置表。
