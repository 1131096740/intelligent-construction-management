# 任务16本地集成收据（真实PG待验）

任务16候选 `214e71880f045f9b02310046958cc3d79d55bbd7` 已按授权独立合入中央 `f913a3136c299c2feaf3f1083348752bf00df338`；合并父为固定中央 `0aa691bf6eb35e719c9f28da64e710b294c06284` 和候选214e，tree `e1b143b8be3eb0993267fa97dd5a6c3127665068` 与候选完全相同，首尾干净。合并提交含 `[skip ci]`。本收据仅为本地实现阶段：#398保持OPEN、17/24保持阻塞，当前13/45按各自边界关闭，193条规格及45任务未整体完成。

## 来源与审查

候选正式source-only packet文件SHA256 `2861fc54ef1a34cfed6f489873a712d5b2bed3dad3104e507bdb93b31ca6127e`，payload seal `902d426c6911a5294eec7c43a68f8407652f737f3e86dc8ff0e3f7b899e27483`，3248份tracked文件、202份迁移源码。其scope明确installedDependencies not-verified、httpPostgresAcceptance not-executed。七份prepared SQL不计新增迁移，保持SOURCE_ONLY_NOT_EXECUTED、不可迁移；source seal不是完整PG准备或执行通过。

最终79审查输入manifest SHA256 `dfd2aded64f7fd973ba7184262f0ba28e3e30266ce50b219afa444eeceabd51f`；独立merger在合并前逐份对Git/packet/磁盘，门禁后再次核79磁盘均一致。原双轴完整审查及后置Standards `2c2faa5c76eef3d9b9d506110dee21d22cee21fc20d63fbe1a49b8fa815bde9e`、Spec `cf59282e4f84d8313537a0306f8eeb6867bb4771e97f8728dd08425235aef073`均0新项；原prepared完整图P2仅在源码闭合，不代表SQL解析、角色、锁或COMMIT已验。[私有阶段详述](2026-11-07-enterprise-simplification-task16-local-milestone.md)。

## 中央新运行（准确f913，逐门一次）

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @jiangkong/shared-domain exec tsc` | exit0，实际emit，0.709秒 |
| `pnpm --filter @jiangkong/api exec nest build` | exit0，13.903秒 |
| `pnpm --filter @jiangkong/web-admin exec vite build` | exit0，9.469秒，原chunk warning保留 |
| `pnpm --filter @jiangkong/web-admin run check:ui` | exit0，0.279秒 |
| 原七治理check-only | 全部exit0：728路由/0未分类、679 wrappers/719绑定、416动作/0阻塞、407写消费者、整体ready、contractMutation80路由/22动作 |
| `pnpm test:ci-orchestration` | 369/369、0失败、0跳过，10.672秒 |

七治理准确argv依次为：`node scripts/inspect-whole-site-capabilities.mjs --check`；`node scripts/inspect-whole-site-web-api-manifest.mjs --check --require-ready`；`node scripts/inspect-whole-site-page-action-manifest.mjs --check --require-ready`；`node scripts/inspect-whole-site-route-usage-manifest.mjs --check --require-ready`；`node scripts/inspect-user-fill-entry-inventory.mjs --check --require-ready`；`node scripts/inspect-whole-site-capability-matrix.mjs --check --require-ready`；`node scripts/inspect-contract-mutation-authority-manifest.mjs --check`。没有运行--write、额外广门、完整API测试或PG runner。既有metadata实现设置SKIP_DATABASE_CONNECT=true并禁文书worker启动，不监听服务、不执行SQL；未发明额外宽松模式。

逐门argv/耗时/logSHA/clean与pins记录：`/private/tmp/jg-task16-independent-local-merger-20261107-phase2-gate-results.json` SHA256 `49c869e536aa0436c95c26dc49952b1586c1690ccfeb81ea20b8cc1272a739ba`。新Shared/API/Web输出完整manifest与总结在同前缀 `phase2-build-output-manifests.json`、`phase2-local-gates-final-receipt.json`。此前68登记公开HTTP、五目标Web71、桌面8（原首例＋第2至8各fresh续跑）/手机3及相关API/Shared/type/lint均只按原准确源码和逐项桥接继承，不称本轮新全API/全UI执行。手机为浏览器390×844，不是真机验收。

## Prisma生成前置与原失败保留

中央原client缺任务16模型。第一轮source-only generate将引擎源设为自身输出，复制时ENOENT；R2使用只读cache basename生成命令0，但runtime预期规范名，后验失败。两次均首停，日志/receipt完整保留；没有自动重试或进入后门。主控分别明确授权后，R3仅创建本次自有临时目录，独立普通副本命名为 `libquery_engine-darwin-arm64.dylib.node`，由cache605197相同字节提供。

R3命令仍为 `pnpm --filter @jiangkong/api exec prisma generate --schema prisma/schema.prisma`；只改引擎路径env，不改Schema、依赖或锁。CLI5.22.0、query engine SHA256 `e0f4077c48e80b36425e6b0295803593eed753988c5f31adfab966b739d4809d`、schema engine `57b090d47b947dc9284379d9480d11ffe14fe63155e3da515b359f3aa7fa408a`。generated输出完全在中央独占pnpm/.prisma/client；源副本/输出不同inode，规范名与runtime引用匹配，cache、源副本、源码、包工具与锁前后稳定。没有连接PG、自动安装/下载或执行迁移。

R3 CLI退出0，但严格Schema字节守卫先失败（active73cbea3e／generated87c25de0），立即停线。主控独立只读核实：差异仅空白格式化及ExpenseClaim同block内一条 `@@index([generalProcurementId])`移至index组；保字符串/注释的189711token流在该精确归整后相等，tokenSHA b1df6e99。明确认可此生成门后才继续构建，未再次generate/format或改source。完整证明 `/private/tmp/jg-task16-independent-local-merger-20261107-root-generated-schema-token-proof.json` SHA256 `4ddda761b89c1cf2dc2ccf529a05ebf4be259e75d3250489473bac9eaa5585db`；R1/R2/R3原receipt和log不删除。

## 未完成与远端边界

完整专用PGdriver、source-derived可运行库存、正常COMMIT/真实提交异常/断连/响应丢失/并发、owner-runtime ACL、锁/phantom/后来投影、资源清理仍未证明；16/42/44硬门继续保留。通知只有合成意图/派发；37后继通知接力、40/44泛用下载UI、43旧工资入口与42/44实际终验分别保留。未运行PG、SQL、资源、迁移、真实银行短信COS/交易、部署或生产写。

10仍在独立私有树本地实施，12继续等待10；本轮10的A4未集成。历史b7d7c8ee远端自动CI曾包含PG并取消的事件保留，不能声称整个会话远端零PG。本次中央仅本地merge和上述验证，未推送、未更新GitHub、未关票、未合main；PR428保持Draft。本文拟提交后的准确最终源码prepare/verify、中央最终SHA及远端动作须由后续主控实际回执绑定，旧候选packet不冒新中央封包。空/跳过checks不计CI通过。
