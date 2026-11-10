# #382 垫资组分阶段迁移夹具：准确候选与单次方案

代码候选 `54e8b60d1186cf6191f7704bcfa0cceef9889b9b`，tree `9bf8016d1f299472b9c9d0f762379e1462e02b1f`，父提交 `97b11e80eb3c003cdbeebe3bc7941a43833383bb`。已由 merger 子代理快进到本地集成分支，9 个路径；没有 GitHub 写入、部署或生产操作。

本轮只补本机临时 PostgreSQL 的安装夹具：精确 203 条前缀独立读回后，创建独立受限应用 ACL 身份，保留实际旧文件调用闭包；在原 204/205 事务四个准确 DDL 锚点授最小权限，提交后独立读回，再拆除控制对象并继续原完整迁移。原 256 份迁移 SQL、Prisma Schema 及锁不改；原七库的历史冲突、显式修复与 resolve 路径保留，不以错误子串自动重试。数据库业务测试仍使用原 jiangkong actor，因此不能宣称受限应用身份的真实业务授权验收。

独立验证副本为 `/private/tmp/jg-382-staged-independent.gytDHH/repo`，从空依赖冻结安装、生成当前 Prisma 客户端并构建共享包。准确候选最终 CI 编排 413/413、两套 CLI 回归 42/42、API 类型/lint/构建及动态清单校验通过；全部源码检查均不执行数据库迁移。前两次验证环境不完整（缺依赖、PATH 缺 sha256sum）的失败日志原样保留，后继仅修正验证副本环境，源码未改。

独立生成五份控制 SQL，经 PostgreSQL 16.1 grammar 的 SQL/PLpgSQL 静态解析通过；最大生成语句 108333 bytes。解析不证明目录、权限、COMMIT 或实际安装成功。独立结果见 `/private/tmp/jg-382-fixture-independent.RqBnYb/parser-result.json`；作者原始 TDD 与交接见 `/private/tmp/jg-382-staged-local-fixture.0ESDbuUo/HANDOFF.md`。

已封存 `/private/tmp/jg-382-staged-independent.gytDHH/verify-once.sh`，只读 preflight 通过；命令与输入摘要见 `/private/tmp/jg-382-staged-independent.gytDHH/RUN-PLAN.json`。源 Git 对象已自包含、移除 remote，准确 main 基线为 `2f474055bd018b3e454b458038d91080203ad5dc`。Node 20.20.2、pnpm 9.15.9、本地 Docker context/socket 与缓存 postgres:16 镜像 ID 已核。正式命令只允许执行一次，意外首错即停，仍保留原测试内明确预期的历史冲突/恢复；先为七个专用库完成其原迁移旅程，再运行原 13 项垫资并发测试。

用户随后授权准确 `54e8b60d` 单次验证，原封存命令已执行一次并退出 1。首库完成 203 条前缀迁移、精确 ledger 独立读回及受限应用/控制资格准备；M204 开始后捕获首条 SQLSTATE `42702`，reason=`POSTGRES_ERROR`。其余六库和原 13 项并发测试未开始，M204/205 没有通过。临时容器已独立确认不存在，原始脱敏 JSON 为 0600；停止回执及校验文件见 `/private/tmp/jg-382-staged-independent.gytDHH/STOP-RECEIPT.md` 和 `STOP-SHA256SUMS`。

本次授权已消耗，没有重试或后继动态组。源码定位 observer 的局部 `pid` 与 `pg_stat_activity.pid` 未限定右值重名，另发现 ACL 检查的局部 `sig` 与 SQL unnest 别名同名；本次脱敏首错没有列名，这些属于源码原因推断。后继仅继续窄源码修复，实际修复仍须准确新候选另获授权。此前 `33e9320a` 仅诊断授权也已消耗；本方案没有重启旧 17 步或旧诊断包。其它 21 个自动组、POL-22、真实归档/资金/恢复门及 #382 全部验收尚未取得本候选的通过证据。本次只读回查 main 未变、#428 仍 OPEN/DRAFT 且远端 head `4ca0965bd752e086a9229eebd2891d9a99c2e8ad`。
