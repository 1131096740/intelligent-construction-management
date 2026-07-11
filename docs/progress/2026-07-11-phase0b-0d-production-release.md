# 2026-07-11 阶段 0B-0D 生产发布记录

## 结论

阶段 0B 金额 BIGINT、阶段 0C 私有文件完整性/替换链、阶段 0D API 输入校验，以及发布前普通付款审批链修正，已随 `main` 提交 `915b86b33e3fc3f387338e440cd1aeb93eae1265` 发布到生产。GitHub Actions Deploy Production run [29152108290](https://github.com/1131096740/intelligent-construction-management/actions/runs/29152108290) 的 Verify build 与 Deploy to server 均为 `success`。

## 发布前门槛

- `origin/main..main` 66 个线性提交完成范围、迁移、依赖、敏感内容和发布拓扑审计。
- 普通付款审批链按正式规则收口为“综合部主管 -> 项目经理 -> 财务总监 -> 董事长/总经理 OR 签”，共享权限、列表/详情入口和前后端展示均对齐；两轮独立复审最终 Approved。
- 生产部署入口改为仓库内 `scripts/ops/deploy-production-server.sh`，独立复审最终 Approved；目标 SHA、服务器工作树、先构建后迁移、staging、停机禁写和失败关闭均有硬门禁。
- 本地最终验证：shared-domain 59/59、Web 318/318、API 1911/1911；Prisma validate/generate、全仓 typecheck/lint、业务错误检查、Web `check:ui`、API/Web build 与 `git diff --check` 全部通过。
- 生产只读预检：原 36 个迁移正常；无超过 1 分钟事务；无使用旧付款路线的在途审批；候选 readiness 全项 PASS。
- 发布前停止 API 冻结写入。备份 `/srv/jiangkong-backups/db/jiangkong-20260711-200634.dump` 为 PostgreSQL custom format，大小 191257 字节；`PGDMP`、`pg_restore --list`、文件 600 和目录 700 均通过。

## 部署结果

- Actions run：`29152108290`，目标 SHA `915b86b33e3fc3f387338e440cd1aeb93eae1265`。
- Verify build job `86543121699`：成功，耗时 2 分 43 秒。
- Deploy to server job `86543306352`：成功，耗时 1 分 51 秒。
- 服务器 `/opt/jiangkong` 的 HEAD 与 `origin/main` 均为目标 SHA；无 tracked 修改，仅保留 `.deploy-backups/`、`deploy.sh`、`deploy.sh.bak-20260706` 三类允许的历史 untracked 项。
- Prisma 迁移由 36 增至 38，schema up to date；`20260710153000_money_bigint` 与 `20260710170000_file_integrity_metadata` 均 `finished_at` 非空、未回滚。
- 21/21 个目标金额/阈值列为 PostgreSQL BIGINT；`FileObject` 的 `contentSha256`、`storageStatus`、`supersedesFileObjectId` 三列存在。
- `jiangkong-api` active；Nginx 配置通过；本机 API、`https://jgzg.site/api/health` 均健康；首页 HTTP/2 200 并保留 HSTS、nosniff、DENY frame、referrer 和 permissions policy；runtime health 通过。

## 边界与后续

- 本次未执行会写生产数据的登录/refresh、大额金额造数或真实 COS 上传下载验收；避免在无专用 UAT 项目、账号和清理口径时污染生产账本、对象存储与审计日志。
- readiness 已确认生产使用 COS 驱动且配置格式通过，但真实上传、下载鉴权、短时链接、篡改/过期拒绝和替换审计仍需在专用 UAT 数据范围内验收。
- GitHub Actions 提示 `actions/checkout@v4`、`actions/setup-node@v4` 的 Node 20 action runtime 弃用；本次未阻断，后续单独升级 action 主版本，不与业务发布混改。
- Web `dist` 最终同步不是无感原子切换；本次在明确维护窗口内完成。若以后要求无停机发布，再单独设计 release 目录与原子切换，不在当前 MVP 中扩建。
