# Task16 B6 registered access：源码与模拟本地收据

基线准确 `90bce686fe9209d41044627675af67b08ab5b06d`；独立作者树 `/private/tmp/jg-382-task16-registered-acl-20261108`，分支 `codex/enterprise-task16-registered-acl-20261108`。本片未提交、推送、合中央或 main。冻结以外部 `...registered-acl-evidence-20261108/freeze-manifest.json` 为准，后续任何修改需重新冻结；所有未来提交与最终 push HEAD 必须 `[skip ci]`。

## 范围与授权

用户已确认“确认全部，仅源码与模拟测试”，包括专用执行器、数据库/角色身份、TLS/集群变化、执行顺序、首败与清理。B6 使用已确认公开 `runTask16RegisteredPg(options, adapters)` + 显式资源模拟，以及原 `installTask16RegisteredSql(options)` + owner SQL 模拟和原只读 source CLI/Git 合成仓库边界。没有新 CLI mock 旗标、私有函数测试、OS race/新进程接口。三组锁专用列及 ALWAYS 拒绝实际 runtime UPDATE 的保护，沿既有 Task16 技术边界；未改变产品 query、Schema、迁移或原业务 guard。

所有 SQL 字符串仅交给显式模拟适配器。没有运行/解析 SQL、Prisma migrate、PG、Docker、TLS、端口/证书/资源、实际交易、通知或生产。已有 Node/Git/source-only CLI 测试只读验证源码或操作自有合成仓库，不等于数据库执行。

## 最终实现

- Driver 在资源返回后只记录一次九字段冻结见证，B5 只扩展输出 ownerOid 与该见证；七片 native facade 严格核对 B5 manifest、source、owner/runtime/observer OID 和第一份见证，不能用新 receipt 替换。旧独立 installer 兼容无 B5 输入，但明确返回 `baselineContinuityVerified:false`；native facade/B6 必须 true。
- Installer 复用唯一 source CLI，不新造弱 parser。packet/七片/B5 manifest 使用现有 qualified FD 有界读取，在每次 owner await 后按身份和摘要复核；捕获资源方法，预检后替换会在 DDL 前拒绝。提交响应中的角色、DB/集群身份漂移保持 UNKNOWN，不重试或称 rollback。
- 新固定 Task16 registered stage，先核 B5→七片 source/角色/DB/资源连续性、202 ledger、完整函数正文和已安装目录见证，再执行同事务中间矩阵→增量 GRANT/三保护→完整最终矩阵→COMMIT 后 nonce 身份/矩阵。没有 B5 reset、全 schema grant 或 marker 普通角色 DML。B5 ContractVersion 锁专用保护、七个关系/十七个函数技术 owner 与其它 grantee 均保留。
- 固定14表列/约束/trigger 目录见证由七片安装响应取得，B6 前/事务/后精确比较。这14表不含三组新增 guard 的 UserPosition、ApprovalInstance、CompanyEntity，因此合法本片 GRANT/guard 不会被笼统目录豁免；三新 guard 独立逐表/函数/OID/body/owner/enabled/类型校验。目录见证不替代函数 source proof。
- 完整核44个七片终态函数（36新声明、8旧目标），包含两 timestamp overload，但只给正常链确需的 WITHOUT TIME ZONE overload EXECUTE。每个 proof 留原 body、hash、签名、来源行及旧函数确定性 literal replace 链。源文件39项封存，非 marker includes。元数据核 owner、language、security、strictness、volatility、parallel、return type/set、唯一安全 search_path。既有 lineage helper 与身份/version guard 另持续校验。
- 精确最终 runtime EXECUTE 为既有2 + 七片固有3 SD API + 正常链8普通 helper；observer 仍只有 identity EXECUTE。marker 无直接普通角色权限；voucher 只读。新增列包含 Account.writeRevision 真 CAS、账户/Execution.xmin、registration.coveredExecutionIds、allocation 五列补齐、impact 两投影；User 登录 UPDATE 不加拒绝 guard。
- 三新锁专用权限为 UserPosition.createdAt、ApprovalInstance.updatedAt、CompanyEntity.updatedAt 的最小 UPDATE，分别有 ALWAYS BEFORE UPDATE 保护拒绝 runtime 实际更新，owner seed 可用。不授 Project DML、不做 SD 桥、不扩大 inactive CompanyEntityVersion 分支。

源码依据来自独立只读笔记 `/private/tmp/jg-382-task16-B6-normal-function-closure-notes-20261108.md` 和最终来源图同前缀 `...final-function-source-map-20261108.{md,json}`（外部 JSON SHA `5ea36cc539e3a1855a138e42abc570068d07a1dc4e1cb5fcb28aea12ec400133`）。完整文本已进入本片 manifest；来源重演是有限字符串处理，未使用 SQL parser，未与真实 pg_proc 对照。

## 红绿与验证证据

外部目录 `/private/tmp/jg-382-task16-registered-acl-evidence-20261108` 保留所有失败，不覆盖旧日志：

- `installer-continuity-qualified-red.tap`：原 installer 无 continuity 字段，公开正控断言失败；`installer-continuity-green.tap`。早先 `installer-continuity-red.tap` 是合成仓库缺 Typescript 依赖环境失败，不算功能 RED。
- `driver-native-handoff-red.tap` → `driver-native-handoff-green.tap`：第一份 witness/原生七片交接；`driver-native-handoff-protocol.tap` 原先一条 NOT_ATTEMPTED 被 driver 预设 UNKNOWN 覆盖的失败保留，`driver-pre-attempt-outcome-green.tap` 证明修复。
- `registered-stage-red.tap`：新公开 run 正控在 registered stage 未实现时失败；`registered-stage-first-green.tap` 是合成 executionFiles 重复列 B5 manifest 的 fixture 问题，修正去重后 `registered-stage-green.tap` 通过。`registered-first25.tap` 实为24测试，17条错误断言不存在的 receipt.normalCaseCompleted 字段，修正观察已公开 stages 后 `registered24-green.tap` 全24通过，不能称这17条为产品 RED。
- `installer-method-red.tap` → `installer-method-green.tap`：预检 callback 换 exec 方法，旧实现调用替换方法并 UNKNOWN，新实现在第二次调用前 NOT_ATTEMPTED 拒绝。纯公开 installer/资源模拟，不是物理连接证明。
- `first-full180.tap` 179/180，唯一失败是旧 CLI 测试仍期待缺 registered capability；已据新真实源码改为精确仍缺 clients/App/seed/normal 四项。`full180.tap` 180/180，最终增加 transport 反例后 `full181.tap` 为原127+原installer18+新增installer12+registered24=181。最终 SQL 模板把 standard_conforming_strings 固定为本会话 on（包括 COMMIT 后），`registered24-final.tap` 与 `full181-final.tap` 为最终源码回归；结果以最后日志 summary 为准。
- `cli25.tap` 原公开离线 CLI 25/25；`types-first.log` API tsc 退出0；`src-lint.log` src lint、`cjs-lint.log` 十一 CJS 定向 lint 退出0；`syntax11.json` 十一 Node --check 均0，两 JSON decode 通过；diff whitespace check通过。依赖仅本作者 ignored services/api/node_modules 的自建链接，未安装/修改共享依赖、不提交依赖。

新增反例覆盖 preflight/commit 角色OID、TLS、ledger、全body/基础保护、14表目录漂移、七片 continuity 缺失、伪造新资源/B5见证、await 后方法换入、提交后资源漂移、敏感 adapter 错误与 first-failure/finally。观察 SQL 协议不等于 PostgreSQL 确实拒绝改 body/禁 guard/越权 DML。所有注入路径保持 `nativeExecution:false` / SIMULATED，错误不泄露 SQL/password。

## 原冻结四项 P2 的集中修复（增量待复核）

原冻结 `a77442344ed42f5dc74c9b39a7a8ecbeba7962877857d6d1db661f9c8910ea92` 被独立 Standards1P2/Spec3P2 拒绝，不能继续作为通过候选。原manifest另保 `freeze-manifest-a774-original.json`、十五文件 before images（并补本次受影响旧baseline SQL/test的HEAD前像）、全部旧红绿和审查报告均保留。当前新freeze明确 supersedes a774；源改后未挪用旧pass。

1. **连续性标志虚假阳性**：原入口以truthy启用校验，却以非undefined报告true；现在所有非undefined输入先强制非null/非数组对象及既有字段资格，null/false/0/空串在零SQL前拒绝。标志只在全部B5 pre/transaction/post核验及源码/资源重核完成后置true，未传仍false。公开installer四反例 `p2-baseline-shape-red.tap` 4失败 → `p2-baseline-shape-green.tap` 5通过（含旧兼容/continuity正控，另跳过的测试不算新增执行）。
2. **observer正常snapshot闭包漏项**：追原case:33–35/42–43，final观察者由8表补为11表；精确只增 Funding(executionId,operatingLedgerEffectiveDateAtRegistration,actualPayerId,actualPayerKind)、Allocation(executionId,accountId,sourceBatchId,amountCents)、Event.executionId 和 Registration.coveredExecutionIds。其余列/写权/EXEC不扩大；中间before仍8表，最终combined及实际delta循环都明确两角色。原公开run→owner SQL参数协议正控 `p2-observer-red.tap` → `p2-observer-green.tap`。这是源已知投影/predicate在owner wire的精确参数检查，不称执行过真实snapshot或证明真实SELECT。
3. **函数完整接口遗漏**：旧44 proof未含IN/OUT接口，此前“完整metadata”说法不足。当前44个精确source声明各留argumentNames/inputArgumentTypes/allArgumentTypes/argumentModes，三个TABLE输出保列名、类型、顺序；同时拒defaults、variadic、procedure/aggregate、leakproof/planner support的变化。三个有序数组明确WITH ORDINALITY排序；无OUT时明确pg_proc NULL语义。七片真实声明均无default/variadic；是固定44项有限source声明清单，不实现通用SQL parser。公开run实际owner catalog request `p2-function-interface-red.tap` → `p2-function-interface-green.tap`；模拟只检查请求包含这些接口metadata及对应pg_proc比较条件，不声称PG实证改OUT/IN/default一定被拒。
4. **锁保护条件化漏检**：三reference guard和B6保留version guard、受影响B5 version validator/后验均要求 `tgqual IS NULL` 且 `tgattr=''::int2vector`，同时保持ALWAYS/type19/body/owner等原约束，拒WHEN和UPDATE OF筛选。旧B5树/中央不动，仅本候选最小安全依赖改动，并更新本片39来源中两项B5 CJS/SQL pin。两个公开run/资源请求反例 `p2-guard-conditions-red.tap` 2失败 → `p2-guard-conditions-green.tap` 2通过；只观察SQL元数据协议，没有运行真实UPDATE或PG。

新增共8（installer4 + registered3 + baseline1），原181完整保留，当前总 **189**（既有127+baseline新增1=128，另installer34 + registered27）；完整 `p2-full189.tap` 与原CLI `p2-cli25.tap` 各零失败/零跳过，API `p2-types.log`/`p2-src-lint.log`、十二CJS `p2-cjs-lint.log`/`p2-syntax12.json`、两JSON decode与diff检查。结果与hash以新freeze为准，旧181/CLI25只保历史。无新增物理或公开seam、无SQL解析/执行、资源或Git/remote写。

## 未满足的门

默认原生入口仍缺 `connectRestrictedClients/startApplication/seedFixture/runNormalCase` 四阶段，在 source/资源前拒绝。无完整真实 driver 或资金验收。SQL_NOT_EXECUTED_NOT_PARSED；真实 PG16 ACL/锁/负 DML、44 body 实际解析/安装、COMMIT/响应丢失/竞争/TLS/物理擦除/清理均未验。owner fixture 有效 ContractVersion/Settlement 所需合法 ProjectAffiliateAssignment 仍后续 loadFixture 前提，本片没有偷偷 seed 或更改业务 guard。#398 OPEN，17/24 与16/42/44硬门、13/45不变；不把本机静态/模拟、GitHub CI 与生产状态混为证据。
