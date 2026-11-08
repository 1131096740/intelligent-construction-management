# Task16 B10 normal-case source wrapper 本地收据

准确基线`5da319815c8d9293c9a5598b1cbe1f585baf5bfc`，独立树`/private/tmp/jg-382-task16-normal-case-20261108`，分支`codex/enterprise-task16-normal-case-20261108`，经formal metadata审批创建。实施计划`/private/tmp/jg-382-task16-B10-normal-case-source-plan-20261108.md` SHA`fa76cd7a62408f734b6e9e57553d2f166528aa8738b1cb0daca0ae043e8474c6`已获主控GO。仅原publicrun/B7 command-createClient/自有fake CJS/既有global.fetch+delegates模拟边界，无新CLI flag/context DI/物理代理。旧B9、中央、A2/02桥不改；未commit/push，futurecommit/finalHEAD全部[skip ci]。

## 实现与首份连续性

- 新`runTask16NormalCase`加载并调用真实已编译`runRegisteredNullCrossCompanyCommit`，不stub passed。B2新增固定case entry的qualified FD/hash/identity、同首次API build/preparation manifest/source/seal及八必要source FD；driver deep-freeze首case witness，在实际private case函数选中时资源前核同actual seed/App函数归属及first witness。无任意路径、晚取receipt或可变boolean自报。
- 同B7 one-shot实际module/exports registry增固定case入口，复用同fixture module及原3client；固定capture inventory/handler和原fixture角色/HTTP导出，每await核当前对象/函数/FD。无第二loadClient/loadFixture、清cache/pathCache、VM、第二Prisma或泛loader。
- B9 source私有WeakMap仅在实际seed成功/full后验/light未取消后发布同context prepared/proof/execution；保原随机确认password、token、16UUID/UTC dates/registrationIDs，不能重新随机或重建。take一次后删Map；case/driver finally和seed失败均release，seed同context不可重试。take/release与case validator皆最初captured函数，不晚经可变exports调资格函数。释放是清自身引用，不称V8/物理擦除。
- case实际消费首份frozen prepared snapshot，原公开context.fixture必须始终同原prepared ref且内容同snapshot；source/proof/App/client/transport/资源沿B9私有inspect/full，不靠nativeProof=true。真实Prisma对象不freeze；proof/执行参数/业务snapshot只freeze自身plain数据。
- 内部continuity追加源内固定case request checker，仍同最初global fetch；seed维持原两POST域，case只准本次paymentId的options GET/registrations POST及requestKey结果GET。source-only模拟漏fake仍资源前拒builtin，零native fallback，不新增public flag或context.fetch。每await用thunk先light再启动操作；full只wrapper事务外前后，observer事务内不再开owner SQL/full或外部命令。
- observer原RepeatableRead/先SET TRANSACTION READ ONLY，维持11表明确select/predicate、immutable opening+canonical postings独立金额。静态读同Prisma5.22 runtime `9ab29d2d...`之_transactionWithCallback/_createItxClient/executeRaw来源：tx为原observer事务创建的独立proxy，不要求tx===observer，也不假设每个lazy delegate getter恒等；只capture一次本tx SET方法后按原this调用。未load/构造真实SDK证明此推断，SDK可能尝试rollback不等于实际rollback证明。

## 固定业务边界和结果

原case ID不变，公司B付A、经营未启用。主案4000分=40元、A/B期初各100、事后A100/B60，非付款四位十进制元与实付两位分精度保持；2分只做独立postings不符的反例，不缩主案或新增付款案件。合法施工party/version/唯一assignment、our_company affiliate NULL与owner UTC seed字段不变。

真实case函数执行：3 seed HTTP后，GET options、POST registration、readonly after、正常同key同command重放POST、readonly final、GET原result；3次readonly快照分别裁定before/after/replay，execution/funding/allocation/event/audit/root各1、A欠B、无经营fact/impact/voucher pending/audit actor、无第二财务效果。确认丢失后不额外重放；正常已确认后的幂等重放不混故障retry。

case financial POST前失败=case-specific NOT_ATTEMPTED（不表示此前owner seed未写）；一旦注册请求尝试，后验漂移/取消/确认丢失/断言失败均UNKNOWN_DO_NOT_RETRY。安全固定code，normalCaseOutcome单次capture有限枚举，原SDK/HTTP/SQL/URL/密码/token不投receipt。原App→clients→resource清理与首败UNKNOWN保留，不Promise.race伪settled、不强杀engine/删除受保护数据补偿。

## 实际红绿和模拟性质

证据`/private/tmp/jg-382-task16-normal-case-evidence-20261108`：

- `tracer-qualified-red.tap`实际缺case wrapper失败→`tracer-first-green.tap`真实source wrapper/B9成功handoff/实际compiled case/7 fake HTTP/3 readonly snapshots通过；`tracer-admitted-green.tap`加资源前first FD归属后仍通过。最初`tracer-red.tap`为fake observer在connect后改$transaction触B7 guard；已把fake配置移到createClient返回前，原失败保留，非产品缺陷。
- `prepared-identity-red.tap`take后替换context.fixture原仍SIMULATED完成；最小`inspectPrepared`每await核同公开ref并让handler读first frozen snapshot后`prepared-identity-green.tap`拒绝，case请求0、原seed3保留，不晚建新基线。
- `admission-money8.tap`含首case witness/entry/build/source FD同byte换inode/validator exports漂移/伪seed函数，资源前零call；额外2分canonical postings令worked balance59.9800而非60.0000，实际handler拒绝且无重放。
- `normal-controls4.tap`覆盖首POST JSON确认丢失不自动重放、幂等重放有第二execution即拒、case export变化、同context/handoff不能二次消费；`readonly-abort2.tap`覆盖readonly setup失败及首POST后取消仍清理；`outcome2.tap`验证getter只读一次/异常不泄漏。`b2-case-witness.tap`只读捕获固定compiled case且其body throw-if-import未执行。

Fake HTTP仅明确7条路径/方法，未知route必throw，原随机确认password与seed login同值但不在断言日志dump；observer输入为独立字面worked rows，Decimal只接明确0/40/40.02等worked值，无服务余额helper给自己作证。测试不是实际Nest guard/业务服务、SDK/PG SQL/COMMIT/锁/响应丢失/物理清理验收，正常handler passed也仅SIMULATED source协议。

## 首完整回归与CLI精确元数据桥

`full-candidate.tap`实际340项＝306通过/34失败，**不是全绿**；34均为旧installer夹具在prepare阶段失败。`cli25.tap`同根因：本片case inventory把过时“resource driver未实现”改为“No failure/concurrency cases or live resource acceptance”，唯一prepare CLI仍固定旧limits，严格CASE_EXPECTATION_MISMATCH。经主控确认新增owned路径`scripts/prepare-task16-registered-pg.cjs`，只同步该一条精确常量；JSON严格match、唯一ID、4000及独立期望不弱化。原CLI文件前像/340及CLIfail保留。

`cli25-limits-green.tap`25/25、`installer34-limits-green.tap`34/34、`admission7-limits-bridge.tap`7/7及`b2-case-limits-bridge.tap`1/1通过；最终10CJS语法/lint、2TS lint、API类型、fixture20、19+42pins/diff均0。原13source bytes全部同b7冻结，新脚本只有上述常量差；`limits-bridge.json`严格核对前后SHA/唯一变化，旧未受影响306按字节/逻辑闭包承接，**不宣最终完整340重跑通过**，由独立merger另跑全候选。

当前candidate16路径（14source/test/profile/CLI＋2MD）。源review最终`source-final-freeze.json` SHA`4fe94fce484b29a5acf0a38c87a3ac3b3f85ff23cc251cdb22578427661a166f`；准确完整路径/前像/实际收据hash以`freeze-manifest.json`/`verification.json`为准，原b7和所有失败不覆盖。

## B10首审P2修复增量（v2，待增量双轴）

原16路径freeze `14b8ea023255cb3fb309eff105cd08bde3ccad7e2793afbe1fb5bc1eabf408fc`及全部前像、首340=306/34fail和CLI元数据桥收据保留。首审Standards0；Spec唯一P2见`/private/tmp/jg-task16-B10-normal-case-spec-review-20261108.md`：第二次正常同key POST后的final snapshot未独立裁定funding/facts/impacts，首笔零影响和API effects空不能证明重放后的持久层仍零。

原publicrun既有fake observer分别仅在posts===2返回额外OperatingFact或OperatingImpactEntry，其余图、余额、API effects空不变；`replay-persistence-red2.tap`实际两条均旧代码SIMULATED成功（预期FAILED_CLOSED，0/2）。最小在final独立快照追加资金记录唯一、execution/原B payer/kind/NULL经营scope及facts/impacts各零检查。没有新增查询、select、案件、Schema/ACL或财务金额，仍40元/B100→60，正常已确认重放和失败不retry保持。

`replay-persistence-green4.tap`4/4涵两持久层反例及重放后funding缺失/错payer；均UNKNOWN_DO_NOT_RETRY、第二POST后不GET result，readonly3次、原资源finally照常。`replay-positive-v2.tap`原完整source正控1/1；CLI25、fixture20、B2固定case FD只读证据1、新API类型/10CJS语法及lint/2TS lint/diff均0。`preserved-contracts-v2.json`核19+42pins且除source pins/baseline摘要外JSON值同14b8。此次执行为上述定向结果，未重跑完整340，不借旧306冒新全绿，最终全候选由独立merger另跑。

14源路径仅cases.ts、normal-case.test.cjs及两JSON来源pin四处变，其余10逐SHA同14b8；加本收据及PROGRESS仍16路径。`source-freeze-v2.json`、`verification-v2.json`、`freeze-manifest-v2.json`替代旧freeze供此次增量审查，原件不覆盖。未注册runNormalCase，未实施SOURCE_ONLY登记门，默认仍一缺资源前拒；仅source/mock，不真实SDK/Nest/HTTP/SQL/PG/资金/物理清理，#398/14阶段不变，无commit/push。

## 冻结、依赖及真实门

最终全候选、CLI25、原fixture20/API类型/10CJS语法lint/2TS lint/sourcepins及精确hash以外部`verification.json`/`freeze-manifest.json`为准。source snapshot `source-freeze.json` SHA`b7a3e697c2f2b23c1ea09f8e7679a808426c0a822bf18ff42888786f89af4537`，当时完整回归尚在途，不借前次B9 321冒本片通过。B5/B6 JSON只更新两TS sourcepins及baseline摘要；矩阵/44函数/guards/7表17函数owner/otherACL/Schema202/七SQL byte不变，未碰新203桥。

v2及之前case source未注册，default仅缺runNormalCase。其后独立登记见下方v3；历史结果不挪作登记后新SHA通过。#398/真实PG资金与14/45阶段不变；无close/ready/mainmerge/部署生产，等待双轴和独立merger。

## v3最后源码注册与固定SOURCE_ONLY闭门（待增量双轴）

v2两轴0后经主控另GO，native map只直接绑定最初私有capture的`NATIVE_CASE_STAGE`，没有wrapper/noop。原必需cap检查保留，缺项非零仍原CAPABILITIES_INCOMPLETE；零缺项后固定`need(simulation, "TASK16_DRIVER_SOURCE_ONLY")`，在freshCLI/source stage/输入包读取/artifacts/资源/SDK/HTTP之前拒。此为源码内固定闭门，不可由options/reference/flag/approval文件打开，未建通用授权引擎。未来只有具体真实实验授权后的新源码审查和重封才可另行考虑修改。

`registration-red2.tap`实际冷CLI和public default均旧CAPABILITIES_INCOMPLETE而非期望SOURCE_ONLY（0/2）。最小登记后`registration-driver-final27.tap`27/27含同两边界、stages空/sourceSha null/资源not-created/native与financial false，输入和artifacts都是不存在路径；default public附带nativeExecution/reference值亦不能越门。缺项injected反例仍拒，完整injected均SIMULATED。`registration-positive.tap`真实source seed→compiled normalcase的完整fake正控、`registration-b2.tap`首case FD只读控制及`registration-types.log`为本次新结果；静态/pins与准确SHA见`verification-v3.json`、`source-freeze-v3.json`及`freeze-manifest-v3.json`。不重跑或宣称新完整340；旧失败、14b8、6a7f、全部前像及实际红绿均保留，独立merger最终另跑全候选。

注册不改变actualcases/fixture/SQL/Schema/ACL矩阵/业务金额/运输或provider协议。核19+42来源pins仍准确，两JSON本轮逐字节不变：其来源列表不含driver/test，故无需级联。相对v2仅driver/test两源码与本收据/PROGRESS两文档变化，完整候选仍16路径。源码allcaps具备只说明适配器存在，真实SDK/Nest/HTTP/PG/SQL/COMMIT/资金/物理清理仍未执行或验收，#398/14阶段/依赖不解；无commit/push。
