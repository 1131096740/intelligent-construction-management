# 五包阶段 E：精确候选浏览器与静态门禁收据

日期：2026-08-03
工作树：`codex/five-package-go-live`
运行时候选 SHA：`4b2a1195c2082e57b20335665e1d74e8a34eb0ea`
父候选：`59cc884e`

## 1. 范围与边界

本轮是在阶段 D 候选上收口阶段 E 的代码质量线、浏览器线，并登记数据库线和运维安全线的真实缺口。`4b2a1195` 只修改了三个 Web E2E 测试文件：补齐合同/结算能力与上传夹具、等待冻结文件重新生成后的新证据、收紧重复文本选择器，以及把预期的 409/503 响应从浏览器运行时错误中区分出来。没有修改 API、Schema、迁移、部署脚本、生产配置或业务数据。

未执行：推送、合并、部署、生产连接、生产数据库写入、真实备份触发、迁移和上线演练。

## 2. 当前 SHA 的代码质量证据

| 门禁 | 结果 |
| --- | --- |
| Web Vitest | 178 files / 1949 tests passed |
| API Jest | 292 suites passed；5723 tests passed；19 suites / 64 tests 为环境门跳过（总计 311 suites / 5787 tests） |
| Shared domain | 15 files / 151 tests passed |
| Web E2E typecheck | passed |
| 浏览器结构测试 | 结算 23/23、项目融资额度 6/6，共 29/29 passed |
| `git diff --check` | passed |

上述测试均在候选工作树内完成。E2E 夹具修复未放宽生产断言，也没有关闭 `pageerror` 检查。

## 3. 当前 SHA 的浏览器证据

| 场景 | 结果 | 说明 |
| --- | --- | --- |
| P0 核心 | 2 passed / 2 skipped | 既有条件跳过保持原样 |
| Workbench canary | 4/4 passed | Chromium + WebKit |
| Contract detail canary | 2/2 passed | Chromium + WebKit |
| Settlement workbench v2 | 6/6 passed | Chromium + WebKit、桌面/移动组合 |
| Handwritten signature | 6/6 passed | 手写签名、移动交接、敏感文件 |
| Project financing quota（Chromium） | 12/12 passed | 桌面/移动组合 |
| Project financing quota（WebKit） | 0/12；12 failed | 预览运行时无法预加载 `AdminLayout`、`BusinessFeedback` CSS；部分用例另有 `Importing a module script failed`，一条移动用例出现 `work-items` 访问控制报错 |

因此浏览器线仍为 **NO-GO**。Chromium 业务断言已通过不等于 WebKit 全矩阵通过；CSS/module preload 与页面级 `pageerror` 仍必须修复或在生产等价环境取得可重复的根因证据后才能放行。不能通过过滤控制台输出来宣称通过。

## 4. 数据库线

数据库静态审计已完成：116 个迁移目录与 `migration.sql` 配对，命名/唯一性/缺失检查通过；Prisma validate 与空 Schema DDL 生成通过；DB 静态 80 suites / 441 tests 通过；readiness、Schema、最近 7 个迁移的 17 suites / 93 tests 通过；运维安全脚本通过。

数据库线仍为 **NO-GO**：19 个动态 suites / 54 tests 因 `RUN_*` 门未执行；尚未完成 PostgreSQL 16 空库全迁移及二次 deploy、最新自然备份隔离恢复、真实约束与并发验证、中段失败回滚和 readiness 实库证据。当前审计还发现 207 个 `NOT VALID`、仅 33 个 `VALIDATE`，以及最近迁移中的历史回填和锁，需要在真实恢复库中验证，不能用静态通过替代。

## 5. 运维与安全线

已通过的只读/本地证据包括：生产依赖 high 漏洞为 0（剩余 4 个 moderate 已分诊）、lockfile hash 校验、7 个 shell `bash -n`、API/运维 Node 检查、工作流 YAML 解析、readiness self-test、API health/security/cutover 11/11，以及生产路由观测 17/17。

运维安全线仍未闭合：尚未取得当前 HTTP 安全头/readiness/401/403 动态收据、自然 Cron 备份 dump/sha/offsite 三件套与异机恢复、告警投递、COS 实证、生产等价维护/回滚证据。确定性阻断 RC-09 仍在：维护模式只冻结合同/标记表面，尚未覆盖结算、付款、费用、资金和零星采购的全模块停写并保留只读；现有运行时健康检查也未覆盖 systemd timer、P95/慢 SQL、队列、COS、审计、幂等和金额不变量告警。

## 6. Go/No-Go 判定

当前候选不能进入阶段 F/G，原因不是实施包 P0 业务写入口未清零，而是阶段 E 的发布级验证尚未闭合：

1. 融资额度终止全量 WebKit 12/12 失败，浏览器线不通过；
2. 数据库动态恢复、迁移、并发和回滚证据缺失；
3. 全模块停写、监控告警和生产等价回滚证据缺失；
4. 四类真实岗位的后端/浏览器负向请求账本和生产等价阶段 F 演练尚未完成。

## 7. 下一执行顺序

1. 在不改业务逻辑的前提下定位并修复预览环境 WebKit CSS/module preload 根因，重跑融资额度 24 用例及相关全站浏览器门；
2. 开放受控的 PostgreSQL 16 空库、最新自然备份隔离恢复、二次 deploy、并发/约束/中段失败回滚验证；
3. 补齐全模块停写/只读恢复和 P95、慢 SQL、队列、COS、审计、幂等、金额不变量告警证据；
4. 将所有验证重新绑定到最终冻结 SHA，形成阶段 E Go/No-Go 包；
5. 取得单独授权后，使用同一 SHA 执行阶段 F 生产等价演练，再讨论阶段 G 的推送、合并与部署授权。
