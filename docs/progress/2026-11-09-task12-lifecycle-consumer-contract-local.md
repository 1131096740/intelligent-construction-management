# Task12 生命周期读取与恢复合同：本地源码候选

## A1 两项 P2 修复（2026-11-09，完整十路径 HOLD 待增量双轴）

A0 Standards0、Spec2P2 原报告/完整九源/195 artifacts/类型桥与全部首败保持。当前仍准确9a4基点，不提交或推送。新 A1 源码冻结完整十路径，增加唯一合同专用 `contract-v2-archive-persistent-proof.ts`，不改 Schema/SQL/SDK/权限/cap。

1. 原公开详情仅反转同轮 `snapshot.files` 的 actual RED 证明 unordered 校验会错误 ready。最小要求 `[0]=真实GD.docxFileId,[1]=真实GD.pdfFileId`；修后 context unavailable，原 POST409/零 Archive/零归档 audit，恢复源后正常。`A1-fix/word-pdf-order-{red,green}.log`，GREEN 1选中/12未选。
2. 原已批准缺 Fact→原 key503 场景新增 detail 断言 actual RED，缺 Fact 时不能 ready/archived。将原 GET 的 Evidence/consequence/Fact/Impact/intent/response 持久证明完整移到同一只读 helper，由 GET 和 context 共用；`proof-source-move.json` 精确核除 receiver/缩进外证明正文相同，GET 原两处当前作者上传权限核验原位保。helper 使用真实原归档上传者作 Fact/请求身份，当前财务读者不被当上传人；财务详情仍原 read owner，archive-requests 原作者接口仍403。context 只将明确持久证据不完整异常转 unavailable，数据库/未知错误继续抛，不泛吞为成功；GET/helper 零修复/重放/审计。

有限公共负控覆盖缺 Evidence、未知 consequence.mode、缺 Fact、缺 Impact、Impact 金额漂移；原 key均503，详情不报完成。缺第一 Evidence 先触原 ContractRead 连续 order 守卫，保原详情400“归档原件清单不完整”，不为测试改旧读取语义；其它缺失为200+unavailable。not_applicable 仅看原冻结模式，今日启用不改旧结果，另一路真实正式 replay 形成 Fact 后仍可读取原结果，不强求零 Fact。核对全程不产生 audit；恢复持久来源后原作者与财务详情均正常。

`A1-fix/shared-durable-proof-controls-attempt3.log` 实际3选中通过/10未选；其中包括原合法 other-inline 流程，未冒全部13通过。提取后 unused same TS6133 是本实现的编译/类型失败（0 tests，HTTP未运行），不是环境或工具失败；与两项实际HTTP RED分开。另有插入脚本 cwd 工具准备失败及缺 Evidence 旧400与预期200不符的1fail/2pass，均保原日志和 `preserved-attempt-notes.md`，不冒业务SQL红绿。

**A1 当前新完整门**：`A1-fix/final-gates/` 的准确十输入重新运行同50集，50/50 suites、2120 pass/2121 total、1原PGskip；API纯type/lint各exit0，diff0。门前后十输入 hash/bytes/mode 同，门后仅两MD更新。此新全50覆盖最终 boolean DTO，不借 A0 修前类型桥成绩。sharedDTO/dist 对 A0 无变化，故无重build。末次四保护树源码/依赖守恒，本树唯一合法DTS仍为 A0 的0e5dcd9a；Schema3f、SQLc579、359 tracked Prisma/204 migration.sql、十一 SDK 成员均保持。A1完整+对A0六路径delta/前像另冻，HOLD供两轴；仍仅source/mock，无真实PG/SQL/parser/ACL/RLS/锁/COMMIT、Client/网关资源或发布证明，#394/cap不关闭或开放。

以下 A0 记录按原件保留；当前结论以上述 A1 为准。

2026-11-09；准确基点 `9a4ce65eb4db23c5ed8d72c6e90477c4e008875c`，tree `a8b8221925ce20695a41309aa3ae5a3e3e309faa`。独立作者树 `/private/tmp/jg-task12-lifecycle-consumer-contract-20261109`，branch `codex/enterprise-task12-lifecycle-consumer-contract-20261109`。当前未提交，完整九路径冻结后 HOLD 待独立双轴；旧 A3 及其所有历史失败不改。

## 真实读取合同

现有 `GET /contracts/:contractId?versionId=...` 新增可选 `v2Lifecycle`。V1 原响应/流程保持。新 union 区分 ready 与 unavailable；unavailable 不返回伪造空 R/T。仅当前 generated/inside/original、真实批准轮次及唯一当前任务、原合同员/申请人/handler、同 V/R/T/正文 R/F、原单一生成记录及真实 Word/PDF 两引用完整对应时可 ready；party_b 必须与本轮冻结的受控 CPS/BPVersion 对应，合法 inline 旧提交/审批/已盖章正例仍保留，只是其后续 context 暂 unavailable。源及文件 hash 必须为完整 SHA256，真实 FileObject metadata 与两引用一致。`references_ready` 仅指 metadata，不表示 GET 验证 PDF 字节；POST 独立核验全部权限/文件/事务权威。

ready 返回真实 actor、V/R/T/正文 R/F、pending_seal/pending_archive/archived、当前业务 eligible 与具体原因；`webWriteReleased:false`、所有 action `enabled:false` 为服务端固定。pending_archive 复用原 canUpload 权威、原 handler 身份，并只读核项目 active 与冻结原参与公司稳定 ID/北京 DATE 半开有效期间；不把当前 CompanyVersion 当参与加入版本。盖章资格不增加这些归档门；已归档历史不因今日项目/参与状态变化改判完成。非当前来源、历史版本、旧轮或不支持来源明确不可办；numeric2 不退回旧 approve_seal/complete_seal/upload_archive/confirm_archive 等办理 action。POST 仍不凭 context 放行，cap 不开放。

## 恢复合同

盖章沿原详情读同 V/R/T 的持久 task 完成者/时刻；返回过成功但未落盘的模拟结果仍显示 pending，另一主管完成不能作为本人动作证据。用户明确再次确认同 tuple 才调用原幂等 POST；本片无新 key/自动重发/新事件。

归档仅原全部 F 后、首次绑定 DML 前 tryG=false 的私有错误，在事务退出且原 key fresh GET 仍 unknown 后返回 `409 / code: CONTRACT_ARCHIVE_BINDING_BUSY / attemptOutcome: not_applied`。仅描述该次预 DML 尝试，不表示其它并发请求已回滚；缺行、一般 409/503、查询或失权错误不产生该证明。原 key 已持久成功优先原结果，不因当前 global 忙而失败。

通用 UNKNOWN 保留原 actor/V/key/完全同 payload 和文件顺序。允许用户先原 key GET unknown、读 fresh 原 tuple 且当前业务 eligible 后，明确手动继续完全同请求；不自动 POST/循环/换 key/修改意图，不推断事务回滚。不同请求同 key 仍冲突；旧原 key 的完整 durable 权威/Fact/Impact 核验保持。CON10 submission 的 UNKNOWN-only-GET 合同不变，未改其 DTO/写路径。

## 原公开接缝与新证据

证据根 `/private/tmp/jg-task12-lifecycle-consumer-evidence-20261109`；使用真实 Nest 路由、guard、读/盖章/归档业务类和真实 adapter→writer→reader，数据库持久层、私有文件与时钟仅沿既有批准边界模拟。未新增 public DI 或 private-helper 测试。

- `context-first-red.log`：真实 GET 缺 context；后首 GREEN 1 选中/12 未选。`context-absent-source-sha-red.log` 与 `context-file-metadata-sha-red.log` 分别证明缺源 SHA、引用/实际文件同时缺 SHA 时不得 ready；各最小修后 1 选中通过。
- `context-inline-source-red.log`→GREEN：原合法 other-inline 提交/审批/已盖章保持，context unavailable。旧 V1 实体详情保旧 action/无新字段；历史版本、旧轮、R/F、GD/ref、CPS/BPVersion 漂移及技术员控制都在原长公开流程。
- `seal-persistent-recovery-first.log`：fake 返回 callback 值但还原未落盘 task/audit，fresh 详情不认完成；明确同 tuple 手动继续后仅一次事件；他人完成者事实不冒本人。
- `archive-busy-code-red.log`→GREEN：false 409 新机器码；missing 503 不含该证明；均零 Archive/Evidence/activation/audit，GET unknown。原 same-key 成功在忙时返回原结果控制保。
- `archive-manual-original-intent-recovery-first.log`：2 选中通过/11 未选，fresh tuple/GET 后人工原 key 继续；enabled 100.0054 真实 writer 已存结果但丢弃 POST body，再 GET/同 key POST 不新增 Archive/audit/Fact/Impact。仅模拟丢响应，不冒真实网络故障。
- `context-current-participation-actual-red.log`→GREEN：项目已停用仍错误 eligible 的实际公开 RED；修后停用/参与结束都为业务不可办，恢复后 eligible=true 但 enabled=false。仅 1 选中/12 未选，不冒完整 suite。
- 原命令配置错误、fake nullable 字段遗漏、首全读回归不支持来源 actor 查询顺序 1 fail/115 pass、插入脚本 cwd FileNotFoundError（未改源，其随后未插入测试结果不是新 RED）都保留。各实际 RED 的日志独立，未以工具错误代业务 RED。首 SDK 静态 audit cwd 失败、只读 ps/pgrep EPERM 也保；不重写历史。

## 当前完整门

`final-gates/commands.json` 记录固定 Node20、安全环境、准确 50 路径和命令。两处 DTO 类型修正之前的精确七输入 `affected.log`：**50/50 suite，2120 pass/2121 total，1 原 PG skip**；同原 test 条数是因为新增公开长流程断言而非新增 test 条目。`type.log` 全 API `tsc --noEmit --incremental false` exit0；`lint.log` 全 API src lint exit0；diff check0。`source-input.json` 七业务输入在这些门前后 hash/bytes/mode 相同。

其后获明确最小增量 GO，仅共享接口的 action.enabled/webWriteReleased 两处字面量 false 改 boolean；服务端运行固定 false，所有其它业务及测试源码字节/mode 不变。`type-only-bridge/` 保修前七输入完整副本、两处类型差异、新声明与全部 JS 字节不变证据；原 owned shared build 后 API/shared type、lint 各 exit0，公开 context 1 选中/12 未选通过。原 2120 记录绑定修前输入，以明确类型桥承接，未声称最终九路径再次整集运行；后继独立 merger 新准确提交仍需其新全 50 门。之后只改两 MD/证据元数据。

日志 ERROR 并未忽略：Task12 的八条私有完整性错误来自各长流程原生成 PDF hash 临时改为 `f*64`，明确断 submit409/零 round 后还原；`registered-payment-execution.http.spec.ts:426` 的 Synthetic outbox 错误来自既有事务失败注入；FileService/PrivateFileStorage suite 其余 ERROR 属其既有损坏/失败负控，原完整日志保留。上述不是生产或意外外呼错误。

COPY 65486 个依赖条目、56360 普通文件新 inode，四 workspace binding 自树内；私有 204 SDK 全 11 成员继承静态声明资格（源 Schema 3f4199、generated b168、305 model、copyEngine=false、四确切 relocation），不构造 SDK/Client 或执行 native。沿已授权 shared 原纯 TS build，两次 68 产物中都只有 `core-flow-read-model.d.ts` 合法变更，全部 JS 字节/mode 同；三个 ignored 工具绑定亦自树，未 install/generate。

`final-gates/dependency-conservation.json`：donor/中央/84cb/checkpoint9a4 全记录源码及依赖不变，本树依赖唯一 delta 为上述 DTS。`prisma-source-conservation.json`：359 个 tracked Prisma 成员（含全部 **204** 个 migration.sql、Schema、lock 等）对准确 HEAD 字节不变；Schema SHA `3f41995f48430e7adfeefb8ec605203d8ce501bb7214c66619a9142bfcf7a3f1`，204 SQL SHA `c579ed280ceb552ec73a259d5aff2fafb11dac56e01661d06c4d30dce16e883e`。

## 范围与剩余门

仅 source/mock。没有真实 PG/SQL/parser/ACL/RLS/锁调度/COMMIT/真实 SDK 或资源证据，无 HTTP 网关、生产或部署动作。Schema/SQL/Task16/profile 与旧权限未改；Task16 仍 203 库存，不能借其旧绿为本片制包。没有 Web 写入口、FaceB/direct/表外/对上/inline 后继闭合或完整 5×3 验收；#394 不关闭，cap 不开放。无 commit/push/merge。冻结只供双轴源码审查，不是整票完成或发布资格。
