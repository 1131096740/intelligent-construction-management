# 五包阶段 E：精确候选浏览器与静态门禁收据

日期：2026-08-03
工作树：`codex/five-package-go-live`
运行时候选 SHA：`728de13a742e56b8d6773e1ba23b802bc739e4d3`
父候选：`c96a31843026ccfc3ae0b49d7cd9dd8da2da3089`

## 1. 范围与边界

本轮是在阶段 D 候选上收口阶段 E 的代码质量线、浏览器线，并登记数据库线和运维安全线的真实缺口。`4b2a1195` 只修改了三个 Web E2E 测试文件：补齐合同/结算能力与上传夹具、等待冻结文件重新生成后的新证据、收紧重复文本选择器，以及把预期的 409/503 响应从浏览器运行时错误中区分出来。`728de13a` 又在融资额度 E2E 登录助手中等待登录后的 SPA 路由完成，消除 WebKit 首轮懒加载被第二次 `page.goto` 取消的测试竞态。没有修改 API、Schema、迁移、部署脚本、生产配置或业务数据。

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
| Project financing quota（Chromium + WebKit） | 24/24 passed | 桌面/移动组合；先等待登录后的 `/首页` SPA 路由完成，再进入项目经营 |

融资额度矩阵原有的 WebKit CSS/module preload `pageerror` 已定位并由测试导航串行化修复；trace 证明资源请求实际返回 200 且 MIME 正确，取消来自第二次整页导航打断首轮 SPA 懒加载，不是 Vite `base` 或资源缺失。该专项浏览器门现为 PASS，但浏览器总线仍未完成四类真实岗位、完整付款/实付/凭证链和 400/403/409/503 请求账本，因此不能把局部 24/24 写成全站浏览器线通过。

## 4. 数据库线

数据库静态审计已完成：116 个迁移目录与 `migration.sql` 配对，命名/唯一性/缺失检查通过；Prisma validate 与空 Schema DDL 生成通过；DB 静态 80 suites / 441 tests 通过；readiness、Schema、最近 7 个迁移的 17 suites / 93 tests 通过；运维安全脚本通过。

数据库线仍为 **NO-GO**：19 个动态 suites / 54 tests 因 `RUN_*` 门未执行；尚未完成 PostgreSQL 16 空库全迁移及二次 deploy、最新自然备份隔离恢复、真实约束与并发验证、中段失败回滚和 readiness 实库证据。当前审计还发现 207 个 `NOT VALID`、仅 33 个 `VALIDATE`，以及最近迁移中的历史回填和锁，需要在真实恢复库中验证，不能用静态通过替代。

## 5. 运维与安全线

已通过的只读/本地证据包括：生产依赖 high 漏洞为 0（剩余 4 个 moderate 已分诊）、lockfile hash 校验、7 个 shell `bash -n`、API/运维 Node 检查、工作流 YAML 解析、readiness self-test、API health/security/cutover 11/11，以及生产路由观测 17/17。

运维安全线仍未闭合：尚未取得当前 HTTP 安全头/readiness/401/403 动态收据、自然 Cron 备份 dump/sha/offsite 三件套与异机恢复、告警投递、COS 实证、生产等价维护/回滚证据。确定性阻断 RC-09 仍在：维护模式只冻结合同/标记表面，尚未覆盖结算、付款、费用、资金和零星采购的全模块停写并保留只读；现有运行时健康检查也未覆盖 systemd timer、P95/慢 SQL、队列、COS、审计、幂等和金额不变量告警。

## 6. Go/No-Go 判定

当前候选不能进入阶段 F/G，原因不是实施包 P0 业务写入口未清零，而是阶段 E 的发布级验证尚未闭合：

1. 四类真实岗位的后端/浏览器负向请求账本、付款/实付/凭证完整链尚未完成；
2. 数据库动态恢复、迁移、并发和回滚证据缺失；
3. 全模块停写、监控告警和生产等价回滚证据缺失；
4. 阶段 F 生产等价演练尚未完成。

## 7. 下一执行顺序

1. 用同一 SHA 完成四类真实岗位、付款/实付/凭证链和 400/403/409/503 请求账本浏览器门；
2. 开放受控的 PostgreSQL 16 空库、最新自然备份隔离恢复、二次 deploy、并发/约束/中段失败回滚验证；
3. 补齐全模块停写/只读恢复和 P95、慢 SQL、队列、COS、审计、幂等、金额不变量告警证据；
4. 将所有验证重新绑定到最终冻结 SHA，形成阶段 E Go/No-Go 包；
5. 取得单独授权后，使用同一 SHA 执行阶段 F 生产等价演练，再讨论阶段 G 的推送、合并与部署授权。
