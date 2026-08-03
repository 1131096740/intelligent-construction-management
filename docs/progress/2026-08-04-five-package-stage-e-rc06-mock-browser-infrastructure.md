# 五包阶段 E：RC-06 Mock 浏览器发布基础设施

日期：2026-08-04
接手基线：`5c691d62cc59a9385cc1bc63c7339bcc1383d650`

## 本轮落地

- 新增统一 `playwright.rc06.config.ts`，固定两个显式项目：Chromium `1366×768` 与 WebKit `390×844`。
- 只接入当前可确定性复用的合同、结算、付款、实付/凭证、手写签名和敏感文件 Mock 用例，共 14 项；配置和 CI 名称均明确标为 `mock`，不冒充四类真实岗位 API-backed 验收。
- 新增 `test:e2e:rc06:mock` package script，并把配置纳入 Web E2E TypeScript 检查。
- 生产发布工作流改为安装 Chromium + WebKit，在既有 P0 smoke 后运行 RC-06 Mock 合同门；失败 trace/截图继续进入既有 `test-results` artifact 路径。
- 修复付款创建测试的列表查询 Mock，使带 query string 的 GET 不再漏到本地 `127.0.0.1:3000` 代理。
- 新增一项 WebKit `390×844` 合同详情 Mock 检查，并等待登录后的 SPA 工作台稳定后再导航，避免取消首轮 CSS preload。

## 验证收据

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @jiangkong/web-admin typecheck:e2e` | PASS |
| `pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.rc06.config.ts --list` | 14 项：Chromium 9、WebKit 5 |
| `pnpm --filter @jiangkong/web-admin test:e2e:rc06:mock` | production build PASS；首轮用于收敛可复用边界 |
| `pnpm --filter @jiangkong/web-admin exec playwright test --config playwright.rc06.config.ts` | 14/14 PASS，11.7 秒 |

首轮试接入额外暴露三项既有 WebKit 移动适配问题：付款详情的隐藏审计标签被 TDesign 右侧滚动操作区遮挡、结算最终件重试夹具没有发出请求、合同清单映射保存按钮保持禁用。它们没有通过强制点击或放宽断言伪装成通过；本轮按“安全复用”边界退出统一 Mock 门，后续应作为独立移动交互/夹具修复处理。

## 仍未完成

该门只证明生产构建上的前端 Mock 浏览器契约，不证明真实权限或后端业务链。RC-06 仍缺：

1. 不拦截业务 API 的四类真实岗位登录和 `storageState`；
2. 合同 → 结算 → 付款 → OR-sign → 实付/凭证 → 财务/审计的真实浏览器长链；
3. 400/403/409/503 统一请求账本、资源存在性不泄露和跨项目权限矩阵；
4. 绑定最终冻结 SHA 的阶段 F 生产等价演练及发布日人工岗位烟测。

本轮未连接生产，未修改 API、Schema、迁移或业务逻辑，未写入业务数据，未推送、合并或部署。
