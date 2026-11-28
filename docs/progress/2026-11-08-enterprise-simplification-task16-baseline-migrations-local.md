# 任务16 B3：准确202迁移执行adapter源码（仅模拟）

沿用用户“确认全部，仅源码与模拟测试”。本片独占新树 `/private/tmp/jg-382-task16-baseline-migrations-20261108`、分支 `codex/enterprise-task16-baseline-migrations-20261108`，准确基线 `db273ffe34adc8373520e7fb463e2ccd5181665b`；原作者树、中央及Task10未写。未commit/push。

## 实现

新增真实native `migrateBaseline`：202迁移与schema逐文件/顺序/字节/sha核验；owner/数据库/OID/system/TLS、resource/source/CA身份冻结；fresh空库前提；固定Prisma migrate deploy argv及凭证只放env的白名单；180秒/1MiB/取消/TERM→KILL受限进程；后验工具、来源和资源复核，再独立owner读取202条完整ledger逐项匹配。exit0不单独算完成，未知不重试、不称回滚；输出仅字节数/摘要。

公开run只有显式 `migrateBaseline:{command:<模拟进程边界>}` 才用真实stage配自有ownerResource协议；不从native补资源/SQL调用，注入仍SIMULATED。默认原生cap由8缺变7缺，所有缺项在任何资源之前拒绝。此前qualified FD reader仅为生产复用导出，所有测试仍走原公开run，不暴露私有函数作测试。详见[stage合同](../../services/api/prisma/prepared/task16/BASELINE-MIGRATION-SOURCE.md)。

source准入结果现在传递实际candidateRoot/schema/migrations，且把新adapter也列入同候选成员检查。原runtime输入测试增加该源码成员；原21只改cap期待为migrate已实现、ownerTLS仍缺，保零资源/无模拟旗标/所有取消与清理断言。没有修改CLI核包、202迁移SQL或schema。

## 公开反例与最终检查

首条stage对象接入原run先FAILED_CLOSED RED，接入真实源码后正控GREEN；既有26协议检查通过后，补公开resource属性与receipt同时换container的RED→冻结最初资源身份GREEN、取消伴exit0的RED→明确取消失败GREEN、tool及可变descriptor同时改的RED→冻结工具和FD身份GREEN。早期红绿在本会话工具输出保留，没有另存原始TAP或预采集所有中途源码hash，不冒其独立冻结原始收据。

最终Node20.20.2原43＋新29共72/72一次通过，0fail/0skip，14.03秒；原source CLI25/25，21.04秒；六CJS语法/CJS lint、API类型和全src lint均退出0，差异检查通过。原17/19/22 runtime测试及21生命周期，包含两个旧P2和全部FIFO/缓存/未知/清理用例，均保留在原43中。

持久证据目录 `/private/tmp/jg-382-task16-baseline-migrations-evidence-20261108`：`final72.tap`、`original-cli25.tap`、`cjs-lint.log`、`typecheck.log`、`api-lint.log`。

| 初版72测试冻结源码（历史，复审前） | SHA256 |
| --- | --- |
| driver | 1570786cca8cd331d89dc3f9c4d1ba279bcd3582e50af992f5cc626be6ed4986 |
| 原21测试 | 41164fff96d82f1ebe2e5017079ecf151fecf74723c4dcd557dada04c810c992 |
| runtime准入 | 31e9054804e5c3a4498468a4d22f15ba3678326a5e8a58dba80e40976e2f3380 |
| 原22测试 | f66a293fab238d44358e4d86cfc3f04469321c3145309c0845b2773085adea1c |
| baseline adapter | 5af8d4f6e54ac0cac8478a2cbe7ef9f1261fdb6f3e7b566060a2d9a7ec708349 |
| 新29测试 | c79436e7b8a6a8e5e09e6055a264f1ee6b31d5d59cc2b87b5a77f75c61d23bf2 |

这些不是db273已包含的源码或最终SHA验收。中央当前仍db273；独立双轴及整合由主控接续，不预称通过。

## 严格限制

新29例实际只读取本树已存在202 SQL源码/schema，owner读/TLS/ledger和Prisma进程均模拟；CA文件是合成文字，不是真证书。超时/未settle/超输出等在command协议边界模拟，未实际启动pnpm/prisma或证明物理TERM/KILL/迁移/PG语法。native process wrapper仅已实现源码，不冒真实正控。开发类型/lint依赖仅本树ignored链接读central现有依赖，无安装或共享修改，不能当隔离runtime闭包通过。

本轮无真实SQL/PG/Docker/端口/真实证书或业务资源、银行/短信/COS/部署/生产写。ownerTLS、baseline及registered精确权限、clients/App/fixture/case七项仍未实接，真实资金COMMIT/故障/竞争/丢响应/清理与#398、17/24、16/42/44门及13/45不变。


## 双轴P2修复冻结（2026-11-08）

原审查报告保留：`/private/tmp/jg-382-task16-baseline-migrations-spec-review-20261108.md`和`/private/tmp/jg-382-task16-baseline-migrations-standards-review-20261108.md`。本轮用户新增授权原话为“确认，仅模拟进程与假时钟”；限原public run的显式五函数process边界，未授权真实spawn/kill/SQL/资源。

Spec修复在命令前双向枚举实际迁移目录与封存202列表，拒绝额外/异常条目，并在ownerRead await后重核目录/源码/工具/资源。stage固定入口source、ownerTransport及owner凭证快照；工具字节与FD身份沿用最初封存描述符，回调修改caller对象不自授新工具。

Standards修复在触及stdio前挂error/close监听，缺PID/管道仍失败且finally收尾；leader close不再取消进程组TERM/KILL或hard deadline。只有close及owned group不存在都观察到才settled；exit0时残组仍失败，持续存在到deadline为UNKNOWN_DO_NOT_RETRY。五函数为spawn/groupSignal/groupExists/setTimer/clearTimer，全函数且无额外key才接入，不完整对象在资源前拒绝，不补真实函数；原command边界保留，所有注入永SIMULATED。

新增10条公开行为：transport时新增203迁移；owner预检返回时新增203迁移；取消后leader close仍保留KILL直至组消失；EMFILE无stdio/PID异步error+close；ENFILE同例；exit0残组随后消失仍失败；exit0残组持续到deadline失败；正常exit0且组消失正控；不完整process边界资源前拒绝；owner回调同时换工具及caller descriptor仍启动前拒绝。

RED文件`review-inventory-red.tap`实际2例失败；GREEN `review-inventory-green.tap`。进程首RED `review-process-red.tap`是未接新seam时的拒绝，不能单独证明旧wrapper缺陷；额外保留`review-original-wrapper-mechanical-seam-red.tap`，临时把原wrapper仅机械接至五函数后运行：leader close过早完成断言失败，EMFILE触发Node test runner捕获的uncaughtException并取消后续用例。随后恢复修复源码，`review-process-green.tap`及`review-full.tap`全部通过。该RED只使用EventEmitter/假时钟，没有启动或杀止真实进程，不冒原生wrapper实证。

最终原72+新增10=82/82，0fail/skip/cancel；原CLI25/25；六CJS syntax、CJS lint、API typecheck及全src lint退出0，diff check通过。证据在同目录的`review-full.tap`、`review-cli25.tap`、`review-syntax.log`、`review-cjs-lint.log`、`review-typecheck.log`、`review-api-lint.log`；原72/25与初版manifest不覆盖。当前freeze源码hash见`review-freeze-manifest.json`。

| 复审冻结源码 | SHA256 |
| --- | --- |
| driver | 3375d069a8714a372564a85ca07c44c4e8fac7bb69ce5093b1f876d89c023ff5 |
| adapter | 99719b3866655e93ebe3dc9a5d99f59e8d044ad37eb838e4a0b5ec35d5ad5533 |
| B3测试39条 | d1a702d35fca2e80b96408630c349a9c2dcc0742b1eb5d9bd8fec11c8116e285 |

其余原21、原22、runtime helper hash仍等于上方初版。当前仅本地修复，独立增量复审待主控；未提交/推送。实际PG语法、SQL、工具进程、物理进程组清理及TLS/资金验收仍未执行，原七能力闭门/#398及依赖门完整保留。
