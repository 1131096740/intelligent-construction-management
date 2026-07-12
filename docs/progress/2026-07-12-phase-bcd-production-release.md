# 阶段 B-C-D 生产发布记录（2026-07-12）

## 发布结论

候选分支 `codex/phase1-org-permissions` 已线性快进到远程 `main`，GitHub Actions Verify build 和 Deploy to server 均成功，正式库 9 个候选迁移全部完成，生产运行验收通过。

- 目标 SHA：`64698078208c9fb1545781e71a0568a264195fa1`
- Actions run：[29193794535](https://github.com/1131096740/intelligent-construction-management/actions/runs/29193794535)
- Verify build job `86653030959`：`success`，3 分 24 秒。
- Deploy to server job `86653299343`：`success`，2 分 1 秒。

## 分支边界

- 发布前审计所有本地/远程分支；远程无候选分支未被聚合分支包含。
- 本地 `codex/add-icp-filing-footer` 只有一个备案页脚重复实现，且文案缺少备案号 `-1` 后缀；聚合分支已有更完整、全量验证的实现。为避免重复组件/测试和非必要 merge commit，未将该重复提交并入生产。
- 远程 `main` 由 `915b86b33e3fc3f387338e440cd1aeb93eae1265` 线性快进到目标 SHA，无 merge commit。

## CI/CD 与迁移

- CI 通过冻结依赖安装、Prisma generate、全仓 typecheck/lint/test、API 业务错误检查、API/Web build 和 Web UI 治理检查。
- 部署日志显式 47 个迁移，9 个候选迁移逐个执行，最终 `All migrations have been successfully applied.`。
- runtime health 脚本返回 `runtime health ok`。
- GitHub Actions 仍提示 `actions/checkout@v4` 和 `actions/setup-node@v4` 的 Node 20 runtime 弃用，本轮未阻断；后续单独升级 action 主版本，不与试运行数据初始化混改。

## 发布后只读验收

- 服务器 `/opt/jiangkong` HEAD 与 `origin/main` 均为目标 SHA，分支 `main`，tracked 修改 0。
- `jiangkong-api` 与 Nginx 均为 active；本机 API、正式域名 API 和 Web 首页均返回 200。
- API 只监听 `127.0.0.1:3000`。
- 正式库已完成迁移 47，未完成/失败 0，本轮 9/9 完成。
- `UserPosition_global_user_position_key` 与 `ContractVersion_one_effective_per_contract_key` 索引均存在，新治理表 9/9。
- 业务行数与演练基线一致：人员 27、合同版本 6、版式版本 4，版式检查修订回填 4/4。
- Nest 上传链路实际解析为 `multer@2.2.0`。
- 正式登录页浏览器验收已展示 `滇ICP备2026013686号-1`，链接 `https://beian.miit.gov.cn/`，新窗口打开，1440 宽度无水平溢出。
- HTTPS 首页保留 HSTS、`nosniff`、`DENY` frame、referrer policy 和 permissions policy。

## 未执行与下一步

- 按用户授权边界，1 条项目级 `super_admin` 异常仍保留，未自动清理。
- 发布后尚未用真实普通账号执行权限矩阵 UAT，也未初始化真实部门/人员/岗位。
- `pnpm audit --prod` 剩余 5 个 moderate 间接依赖风险，待框架/上游专项升级，不用跨主版本 override 冒充修复。
- 下一步必须先由用户单独授权清理该权限异常；清理后再通过页面逐条初始化真实组织岗位并执行普通账号 UAT。
