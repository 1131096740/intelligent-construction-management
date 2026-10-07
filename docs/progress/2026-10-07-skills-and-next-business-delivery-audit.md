# 2026-10-07 skills 更新、业务交付与上线缺口核验

## 结论与证据身份

本轮只完成本地 skills 更新、实时 GitHub/主线核验，以及 #307 的有限依赖补丁和局部验证。业务实现已交付，不重复 P0/P0.5 UI；当前安全门仍失败，不能发布。

- 用户主目录 HEAD：`a6a9b08a94c0ac9747b9741bb5563e8522ce435c`，main 落后缓存 origin/main 303 提交；8 个已有修改文件及原有未跟踪目录均保留。没有 reset、stash、clean、覆盖或纳入这些改动。
- 实时远端 main：`a6a10433e7c6cb7743f9acf58971ec827b48df2f`；独立 checkout `/private/tmp/jiangkong-next-delivery-20261007` 从该 SHA 创建，分支 `codex/307-dependency-delivery-20261007`。
- 独立 checkout 不包含用户主目录未提交内容，且未读取或复用其他旧候选。
- 本地依赖补丁未提交，身份为上述基线 + patch SHA256 `fd6c15d6ede0af60373576f78a85f11f1a355926f1ce156647530d905a30d4bf`。任何旧 CI/PG16/浏览器收据不自动覆盖该补丁。
- 已读取用户当前 AGENTS 规则、主目录与新主线 AGENTS.md / PROGRESS.md、CONTEXT-MAP、文档索引与相关领域词汇。主目录 PROGRESS 的历史候选记录不能覆盖当前主线结论。

## Skills 安装、更新、保留与回退

[官方安装说明](https://github.com/mattpocock/skills#installation-30-second-setup)：Codex 使用 `npx skills@latest add mattpocock/skills`；可用 `--agent codex --skill <names> --yes` 限定客户端和技能，`--global` 才是全局安装。当前 CLI 1.7.1 帮助确认 `update [skills...] --project/--global --yes`；不能盲目全量更新，以免删除上游撤销项或影响其他客户端。

本轮固定上游 `f3fc5632f401156837ee3872f14fe33ccf1024ea`。依官方 CLI 的目录哈希算法（文件路径 localeCompare 排序，再将路径与字节送入 SHA256）对照已有 lock：

- 项目现有 35 个技能：32 个无本地修改且上游变化，已按固定上游更新普通文件及锁定路径/hash；2 个原本一致未改；`resolving-merge-conflicts` 已被上游撤销，保留原件，不自动删除或换名。
- 全局 lock 的 mattpocock 条目中实际存在 17 个目录；15 个与锁定基线有差异，2 个被上游撤销。所有实际存在的目录及全局 lock 均逐字节保留；不恢复 lock 中已经缺失的目录，不安装新技能或改其他来源技能。
- 保留仓库既有 CONTEXT/文档约定和用户当前 AGENTS，不因上游改用 GLOSSARY 而重写项目控制面，也不运行会修改 CLAUDE.md 的自动 setup。
- 为控制更新边界，本轮按固定 clone 的审阅内容替换已证实无修改的项目目录，未执行不受限的自动 update。原目录先移动为持久备份，锁文件前后版本和全量清单同时保留。
- 备份：`/Users/leoyang/Projects/建工智管/.skills-backups/20261007-mattpocock-f3fc5632/`。
- 回退：`python3 /Users/leoyang/Projects/建工智管/.skills-backups/20261007-mattpocock-f3fc5632/rollback.py`。脚本先核验所有更新目录和锁文件仍与本轮更新一致；若之后有修改则拒绝，避免覆盖新自定义。
- 已在隔离副本实际回退并核对 32 个旧目录及原 lock 逐字节一致；官方 CLI list 能识别项目 35 个技能。更新将在后续对话加载；本轮不宣称自动重新加载 skill catalog。

## 已完成内容与既有测试

实时核对 #114、#115、#117、#121 均 CLOSED；#93/#122/#123/#124/#307 OPEN。#114 合同结算付款归档、#115 费用采购资金、#117 全站入口与旧写入口收口无需重做。TDesign 唯一基础 UI 库约束保持，无 UI/Schema/权限变更。

main 的 [CI 36071631218](https://github.com/1131096740/intelligent-construction-management/actions/runs/36071631218) 全部 21 jobs success，包括单测、质量、构建/清单、PG16 动态组及 release gates，绑定 `a6a10433…`；这是已完成的历史运行结果，不表示 10-07 的漏洞公告门仍通过。

PR #306 仍 OPEN，head `ea45c80d156cc3dec471ea5306f97b466195db7e`，9-27 CI 21 jobs success。未修改或合并该 PR，也不把它视为生产执行授权。

源码抽查：Web `core-flow-read.api.ts` 的 recordPaymentExecution 调用公开 `/payments/:id/executions`；API PaymentController 转交 PaymentRequestService.recordExecution。服务在事务中执行幂等回放、版本锁、当前项目财务岗位、我方主体快照、待付款/部分实付状态、批准余额与结算余额、凭证归属校验，再追加实付、资金分配与状态更新。已有完整流程具备后台实现，本轮不新增相同业务入口。源码抽查不能替代新候选动态验收。

## 下一条可交付完整业务流程与验收标准

下一条为现有“合同及结算审批归档 → 付款申请及审批 → 分次实付与凭证 → 付款/结算余额及历史回读”的发布验收闭环。先解除独立安全阻塞，再固定最终候选，在合成环境复用已有接口与页面完成全部验收，不重新设计 UI。

1. 合同经既定岗位审批、签章归档生效，结算审批归档有效后，才能申请付款；历史记录始终引用原合同/条款版本。技术管理员不得替代业务岗位。
2. 独立预期样本：结算 5000 元，申请/批准 3000 元，分次实付 1000 + 2000 元。首次后付款剩余 2000、结算剩余 4000；第二次后付款剩余 0、结算剩余 2000。支付不再次计入成本。金额精确到分，由后端权威回读证明。
3. 每次实付有私有凭证、项目财务岗位、当前密码确认与当前版本；同幂等请求重放不产生第二条实付/资金事实。越权、跨项目、过期版本、超额及错误凭证均拒绝且零正式写；失败事务回滚。
4. 桌面 1366×768 和手机 390px 经真实页面完成保存/审批/凭证/实付与刷新再进入；中文版字段、业务状态、下一步与历史完整可读，无技术标识泄露或横溢。页面消费领域 API，继续使用 TDesign 与 --jg-* tokens。
5. 合成 PostgreSQL 16 的公开 HTTP 链、真实浏览器链、受影响回归/typecheck/lint/check:ui、正式清单、high/critical=0 及完整 release:local 均绑定最终同一 SHA。已有 CI 和 mock 浏览器结果不得拼接成新候选真实链。
6. GitHub 交付、生产归零、同 SHA 部署和正式开放分别记账；#122 → #123 → #124 的材料、恢复、停写与业务验收缺口不能靠功能完成取代。发布前向用户取得对应明确授权。

## 本轮 #307 有限补丁与验证

仅更新现有 override：brace-expansion 1.1.18 → 1.1.21、2.1.4 → 2.1.7，以及 pnpm-lock.yaml 中对应完整性、快照与 minimatch 引用。未升级直接依赖、其他 transitive 版本或改业务源码。补丁共 2 文件、13 additions/13 deletions。

环境：Node 20.20.2、pnpm 9.15.9；审计独立进程 `npm_config_userconfig=/dev/null npm_config_fetch_retries=0`，直连且禁自动重试。

| 检查 | 当前结果 |
| --- | --- |
| pnpm frozen-lockfile install | exit 0；初次 Prisma postinstall 打印缓存 EPERM，不能用安装 exit 0 代替 Client 可用证明 |
| Prisma Client generate | 全局缓存受限后，将两引擎按原 .sha256 核验、复制至隔离目录并用官方引擎环境变量指定，生成成功；全局缓存未修改 |
| Excel/导入相关 Jest | 5 suites、103/103 passed，exit 0 |
| CI orchestration | 119/119 passed，exit 0 |
| API typecheck | Client 生成后重新执行，exit 0 |
| API lint | exit 0 |
| brace-expansion 实际运行 | 两版本均精确输出 {a,b}{c,d} 四组合，7000-group parse 返回 7001 项且无栈溢出 |
| git diff --check | exit 0 |
| prod audit 前 | 7 high / 1 critical / 4 moderate，exit 1 |
| prod audit 后 | 3 high / 1 critical / 2 moderate，exit 1；brace-expansion 公告已消除 |
| 新候选完整 release/PG16/browser | 未执行；安全门阻塞、补丁未形成固定提交，不生成通过收据 |

剩余安全发现超出 #307 票面唯一范围：

| 依赖 | 审计等级 | 公告 | 公告修复版本 |
| --- | --- | --- | --- |
| proxy-addr | critical | [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) | 2.0.8 |
| source-map-js | high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) | 1.2.2 |
| @vue/server-renderer | high | [GHSA-g2v6-rqmx-r4w6](https://github.com/advisories/GHSA-g2v6-rqmx-r4w6) | 3.5.42 |
| sharp | high | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | 0.35.5 |

这是锁文件/公告命中，不等于已证明本系统运行态每条均可利用；当前项目 high/critical=0 硬门仍不得豁免。另有 @nestjs/core、multer 各 1 moderate，未扩大本票升级范围。下一步应将上述 4 个高等级依赖单独定界、完成对应回归与完整新 SHA 门，再恢复发布验收。

## 交付边界

- 本地：skills 已更新并可回退，有限依赖补丁及以上局部测试完成；PROGRESS 只在独立 checkout 更新。
- GitHub：只读核验；无 commit/push/PR 创建/合并/关票，也未抢占 #307 远端 owner。新补丁尚无 CI。
- 部署：未执行。
- 生产：未连接数据库/SSH/COS、未扫描、迁移、归零、开放或读写业务数据。生产当前运行 SHA、备份与健康均未实时复核；历史上线/备份结论不作为当前事实。

本地日志在 `/private/tmp/jiangkong-307-*.log`，审计 JSON 为 `/private/tmp/jiangkong-307-audit-before.json` / `after.json`；补丁为 `/private/tmp/jiangkong-307-local.patch`。下一次继续必须刷新 origin/main、owner、PR、公告和候选差异。
