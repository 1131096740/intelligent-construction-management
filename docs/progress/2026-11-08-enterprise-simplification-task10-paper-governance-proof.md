# 任务10 纸面动作治理的本地证明（2026-11-08）

候选仍为 `/private/tmp/jg-382-task10-current-integration-20261107` 的本地 `8f7aa1e5e7eca9c297b0f3501a41b25b366f9b56 + WIP`，不是已提交实现 SHA。此片仅更新既有公开治理分析器、其公开生成器测试及实际生成的登记/清单；原 `ContractBodyPaperPreview.vue`、业务 API、Web API producer schema、Schema、权限和 CI 库存未改。原 b846 作者树及其 WIP/失败收据保留。没有提交、推送、合 main、真实 SQL/PG/资源、部署或生产操作。

## v6 当前：源码双轴零未闭，完整本地检查完成，执行桥待回读

准确code-only snapshot `/private/tmp/jg-task10-governance-v6-source-review-20261108/manifest.json` SHA `489df716498046c67f2b7c5652503fc37a40f681e9a4eba34a7ca7995c8e98c0` 已由独立Standards/Spec分别核十三路径、原问题关闭且0新增；两报告 `/private/tmp/jg-task10-paper-governance-{standards,spec}-v6-source-review-20261108.md` 原件保留。它们当时仅SOURCE ONLY，不冒后继执行。当前执行库 `44dcc06a1c5efe8bfb837308016e862af81fec6be22823a5711c0e688e070975`、测试 `6316771022b39bcc2d4dc0c0c95ef129f0a3ea4b3cbd4ba098a1302644b05421` 与该双轴源码完全一致，仍为8f7本地WIP，不是最新中央或整票验收。

- 原公开page-action入口完整 **359/359、0 skip**（原91+治理新增268），172.638秒，原360秒预算不变：`/private/tmp/jg-task10-paper-governance-formal-v6-full-parser-20261108/receipt.json`。
- 原CI编排 **369/369、0 skip**，11.718秒：`/private/tmp/jg-task10-current-ci-orchestration-governance-formal-v6-20261108/receipt.json`。原CI/PG库存未改，新增268不冒原369。
- 新 **r13七write/七check 14/14**，各步骤sourceChanges为空：`/private/tmp/jg-task10-current-governance7-r13-20261108/receipt.json`。真实paper generation/file均ready、serverDerived/dominates，1+2 binding均causalVerified。
- 各执行source/私有依赖/runtime守卫同；lint测试零、库仍原六项unused/新增零，共享58,799项后验未变。完整359后仅本MD与PROGRESS更新。最终versioned freeze `/private/tmp/jg-task10-governance-formal-v6-freeze-20261108` 逐hash连接489df十三路径→16次执行全部before/after→最终两MD变化，保存原始/阶段前像、v3完整包、v4/v5/v6源码checkpoint、所有RED及准确收据；**源码两轴0与执行/文档桥回读分开，最后桥仍待独立核实**。

最终边界：scalarRefValue与record data明确分开。Ref单层.value所有初值/写入须scalar，冻结容器不成为coercion资格；record只供逐字段读取，const/参数alias完整保留Member后缀，终值按record.fields/environment/seen与实际已登记writer frame核查，unknown拒。所有.value replacement须积极scalar/frozen或原已证明字符串/native URL来源；未知factory/caught值不因“不是Object/Array literal”而获准。额外producer只在其原source/target证明就绪后启用，清source缓存重新检查，不复用caller-frame成功结果。

静态非computed optional Member仅在本地data/scalar读取resolver查询同字段，null分支undefined无effect，nonnull仍需原来源；未改权限全局member/path/atom非空支配。computed需真实scalar返回且原predicate纯度，Boolean/!本身不做对象转换，内部表达式仍由原逐节点effect检查。general try/directCallTargets/serverReadImports、真实Vue/API/formatter、producer schema、权限/共享Schema及业务请求不变。默认坏runtime/旧LO fallback产品未改。

技术fixture修正有明确意图与原件：synthetic props/context原自称readonly而未冻结，外内显式freeze；basic synthetic reader原从不填充null，改为明确deep-frozen owner/context（原ownerKey/generation/version/R假数据逻辑），使字段路径可达。generationGrant仍初null→真实GET投影后冻结；原owner/predicate/regexp与全部断言保留。唯一raw-cap escape reader替换锚点同步并assert替换实际发生，十三getter恶意变体也各assert锚点，未删/跳测试。真实Vue/code/API来源始终单独验证，不以synthetic模型替代。

所有中间事实不抹去：v4 `81b2` 的355/369/r11通过只是有已知unknown replacement残留的旧源码；v5 `6bada8` 的r12通过、完整357 **NOT STARTED**（预审先发现frozen container/valueOf与child alias）均见各known-gap checkpoint；不冒当前359。Ref value alias、unknown factory/caught replacement、frozen valueOf Identifier与child Identifier两组反例均在原public generator实际wrong-ready RED→修复GREEN。完整Member路径首轮24正控拒绝、真实pending?.generationId外部诊断、空synthetic reader和后继修正均保原失败/定向收据；未放宽预算或恢复整体record primitive。

#392仍OPEN、12等待10；B只有84049只读方案，尚未native重现/实施（当前1d91若坏discovery仍产正确中文，应INCONCLUSIVE，不凭unqualified命名造产品RED或lock硬门）。A07八源、最新中央同步、整票复审/范围Git整合尚待。未commit/push、合main、SQL/PG/资源、部署、生产操作，以下均为前序准确源码阶段。

## 原v3阶段：可变子对象投影别名本地修复（历史源码）

原v2（manifest `22d177df…f91fed`）Spec原cross-frame P2关闭/无新增，Standards发现bare getter同类投影alias残留一项：模块ordinary nested literal的child经别名定义accessor后，catch裸读仍可能误判data。准确两报告 `/private/tmp/jg-task10-paper-governance-{standards,spec}-review-v2-20261108.md` 保留；本轮只处理该项，不以本轴0抵销另一轴。

原公开generator的 `opaque.child.id`、`alias.id` 两例都真实wrong-ready RED，见 `/private/tmp/jg-task10-paper-governance-formal-nested-alias-red-20261108/receipt.json`。最窄方案将未证明的ordinary nested mutable literal/子数组保守视为unknown；冻结外层也不当成深冻结。GET JSON、已证明frozen record/primitive field、实际Vue来源仍沿原来源，不造一般heap/深对象alias解释器。

两个旧synthetic getter正控把自建props/context作为readonly模型，却仍是嵌套mutable literal；按主控明确核准仅将该fixture外/内Object.freeze，值/owner/predicate/regexp与原两正控断言不变。原十三恶意变体均保留，并逐项assert replacement确发生；无删除/跳过测试，未修改真实Vue。frozen primitive字段只通过已有fieldOrigin.record.fields逐字段回溯其真实value，未知仍拒、seen闭环，不把整个record当primitive。

准确本轮源码库 `84d60a922291fdc4ca3217deb84566ee52585ae56d6bfb1b882b869ab0c62abe`，测试 `ec1f62d0aa245191b8db2d3bdb2a332ebab0abc5f0c59235ea6afbf69f4226b1`，相对v2两文件各+11/-2行。最终完整 **353/353、0 skip**（原91+治理262），161.969秒、原360秒预算未提高；原 **369/369、0 skip**，11.748秒；新 **r10七write/七check 14/14**，均无源码或生成物变化。实际两paper动作ready、serverDerived/dominates与1+2 binding causalVerified。准确收据分别为 `/private/tmp/jg-task10-paper-governance-formal-v3-full-parser-20261108/receipt.json`、`/private/tmp/jg-task10-current-ci-orchestration-governance-formal-v3-20261108/receipt.json`、`/private/tmp/jg-task10-current-governance7-r10-20261108/receipt.json`。

源码/私有依赖/runtime守恒、最终lint仅原六项unused且测试零问题；58,799共享依赖后验未变。完整353之后仅本MD与PROGRESS更新，精确v3 freeze `/private/tmp/jg-task10-governance-formal-v3-freeze-20261108` 含v2全包/原前像、新snapshot/delta、所有失败与当前gates供增量双轴复审。仍待独立复审，不冒整票或最新中央通过；旧351/r9/262定向各保原准确源码边界。

B只有只读最小方案 `/private/tmp/jg-task10-B-bad-font-minimal-plan-20261108.md`，未执行native/HTTP、未动B产品。当前1d91坏discovery若仍产正确可见中文必须INCONCLUSIVE，不能仅凭unqualified命名发明产品RED/批准lock硬门；需实际缺陷与既有规范决定修复。A07、最新中央同步及#392整体剩余门保持。无commit/push、PG/SQL/资源、部署或生产操作。

## 原v2阶段本地结果（历史源码）

原 d262 治理源码经 Standards 两项、Spec 一项 P2 复核后，仅继续修改原分析器和原公开生成器测试。当前库 SHA256 为 `37b3b83f4592aed309286bdda9bafd53d2e5a589edbe92f4a708e109e844663c`，测试为 `f66546d205537859d0aa8f190cc036648c5c87ab67f0ba2ce1011bb30d9a8a79`。原 Vue、两业务 API、formatter、producer schema、权限、CI 库存未改；这仍是 8f7 基线 WIP，不是最新中央或整票验收。

- 原公开 page-action 测试完整 **351/351、0 skip**，含原 91 与治理新增 260（较原 327 再增 24）；178.715 秒，原 360 秒预算未提高。准确收据 `/private/tmp/jg-task10-paper-governance-formal-final-full-parser-20261108/receipt.json`。
- 原 CI 编排 **369/369、0 skip**，11.284 秒；收据 `/private/tmp/jg-task10-current-ci-orchestration-governance-formal-final-20261108/receipt.json`。新增公开反例不冒原 369，未改 CI 或 PG 库存。
- 新 **r9 七 write + 七 check 共 14/14**，各步骤源码变化均为空；收据 `/private/tmp/jg-task10-current-governance7-r9-20261108/receipt.json`。真实 generation/file 两动作均 ready/serverDerived/dominates，生成一个、文件两个 binding 均 causalVerified。
- 上述源码、88 项私有依赖链接、493 项原运行输入前后相同（CI 额外封原 sha256sum 为 494）；最终 lint 测试零问题、库仍原六项 unused，新增零。完整共享依赖 58,799 项后验另见 preparation 下 `shared-dependencies-postgovernanceformalfix.json` 与 `paper-governance-analysis/formal-final-shared-guard.json`。

修复边界：同步 predicate/getter 明确拒 async/generator；每次 native RegExp/typed string 参数按有效 frame 重验，删除 AST-only pure-call/array-copy 成功缓存；catch 裸 Member 需要 GET JSON、已证明 frozen record、实际 Vue/路由来源或静态 data descriptor，未知 getter/factory、裸 caught value、盒装 ref 与 accessor alias 逃逸均拒。source-only descriptor/confinement 缓存仅在本 proof AST/binding 内存完成结果，调用者、await target、实参/effect 不缓存。timer handle 只缓存静态结构，callback 在本次 frame 验证；合法轮询状态只用 sourceIdentity、owner 坐标及完整 GET 字段/冻结形状闭合。无 initializer 的 Identifier 不再兜底 primitive；仅复用既有同 GET/filter 来源的 JSON 迭代首参，未就绪仍拒。

真实 API 数据读取也保持最窄来源：目标 POST 的 JSON 返回只给 data 资格，不升 serverReadImports/权限；默认未知 imported factory 仍拒。真实 private PDF API 的 fixture 现复制实际下载片段，保 GET/POST/ticket-followup metadata、target `unverified` 与原 URL/MIME/token/伙伴要求；仅证明本次 awaited target 结果的 `blob`、`blob.size`、`fileName`，Blob 必须来自同 Response.blob。六个错 Response/伙伴/factory/MIME/URL/accessor 反控均拒。原 body wrapper 仍 unverified，仅原五个正文坐标按字段保留，warnings 不成为 authority。

原始失败分别保留：三项正式发现的五个 wrong-ready RED，opaque factory/alias、unknown member、plain factory result alias 与 caught-value coercion 的实际 RED；首个 JSON fixture 的 sourceFileSet 拼写异常不计产品 RED；重复静态逃逸扫描导致的原 180 秒 timeout 不放宽预算，后继仅静态 source 去重。r7 实际 check-3 因真实 Blob 来源未证明失败（前七写、前两 check 已过），外部诊断精确定位 result.blob.size；新增准确 API 片段公开正控 RED→GREEN 后 r8 14/14，但 r8 不是最后 unknown-catch 修复的证据。最后只以同源 r9/351/369 为当前结果，不混旧 d262/327、旧 342 或 timeout。

新外部 freeze `/private/tmp/jg-task10-governance-formal-fix-freeze-20261108` 保留原十三路径、原始/阶段前像、d262 snapshot、完整原 scope 与新 delta、所有阶段收据和准确 hash，供三项 P2 的正式双轴增量复审；复审仍待，不宣称独立关闭或整票通过。以下 r6/d262 结果为历史源码记录。

## 原 d262 阶段通过及边界（历史源码）

- 原七组 CLI 各 `--write` 后各 `--check`（原需要 ready 的五组继续 `--require-ready`），实际 **14/14**。收据 `/private/tmp/jg-task10-current-governance7-r6-20261108/receipt.json`；写入仅既定生成物，检查无写入。真实 `web-page-actions.status=ready`；两 paper 动作均 serverDerived/dominatesTrigger，生成一个、文件 capability GET 与 ticket POST 两个 binding 均 causalVerified。
- 原 page-action 公共测试入口完整 **327/327、0 skip**，含原 91 与新增 236；144.076 秒，收据 `/private/tmp/jg-task10-paper-governance-final-full-parser-20261108/receipt.json`。新增只走原公开生成器，未导出私有测试 seam。
- 原 `pnpm test:ci-orchestration` **369/369、0 skip**；11.766 秒，收据 `/private/tmp/jg-task10-current-ci-orchestration-after-governance-r6-20261108/receipt.json`。只按既核事实补原 clean PATH 的 `/sbin`，额外封原真实 sha256sum 二进制；未改 CI、计数、PG runner 或其库存。新增 236 不冒原 369。
- 上述 runner 的 source/private dependencies/runtime 前后均同。中央共享依赖完整 **58,799 项未变**，见 preparation 下 `postgovernancer6` 守卫。ESLint 使用既有 API 标准配置：测试文件零问题；库仍仅原六个 unused 项，无新增，见 `paper-governance-analysis/final-eslint.json`。不清理无关旧项。
- 此后仅补本收据与根 ledger；被这些检查消费的代码、登记、生成物和业务源码不变。准确治理外部 freeze 位于 `/private/tmp/jg-task10-governance-review-freeze-20261108`，其 manifest/patch/前像与完整测试收据用于正式双轴复核；不是整票最终验收。

## 最小能力与真实失败

登记表指向实际 `generationGrant.value.actions` 与 `previewGrant.value.serverAvailableActions`。分析器只证明现有有限词法链：唯一 GET、同 owner/版本/文件伙伴、冻结记录与内层数组、等待和支配、新 record 确实替换后才捕获快照、必要 includes/key/enabled、只读 catch/polling 与 UI finally。未知执行语法默认拒；有限当前文书搜索只批准实际那个经过证明的 for-const 节点，不开放通用循环。文件搜索按 purpose/layout/contentR/fingerprint/source 过滤，ready PDF 再同时匹配 expected 文书/文件/指纹；URL 仅接受本次已等待下载结果的 blob。

原 Standards generation 预审发现 freshness（未等待/不支配及条件替换/提前成功）与盒装 raw-ref accessor 两项 P2，均经原公开反例 RED→最小修复→GREEN；v2 外部增量已只读关闭这两项。后继 file/shared/字段投影仍须正式 Standards/Spec，不能继承该局部 0/0 为整片通过。错误实参借缓存、predicate 重赋值、隐式 coercion、unknown effect、catch/finally 重发及 40 个真实 file 变体均保留对应原始失败/通过收据。

r5 实际跑到 check-3 失败：真实 `fetchContractDraftBody` 返回 `{...body, warnings: normalize(...)}`，其 wrapper 正确保持 `returnProvenance=unverified`；早期原 Vue fixture 的 transparent stub 只证明脚本链，不能替代真实 API。后继新增真实 API 片段加 honest unverified metadata 的公开 RED，独立按字段证明五个未覆写坐标（id/R/contentR/layout/source），不改通用 transparent/serverReadImports、producer schema 或 warnings 信任。额外 spread、计算/protected 覆写、raw-body 逃逸、多返回、未知 mutation、normalizer/transport 重赋值均拒，warnings/其它字段不能借该证据成为 authority。随后 r6 实际 14/14，未手写 ready。

## 仍保留的整票工作

#392 OPEN，12 等待 10。默认样张/旧 LO fallback 的已知 B 坏字体 blank-success 失败关闭仍未修复；trusted O 与 docx4j 错角色负控不能替代它。A07 五类八源的来源/业务覆盖映射仍需完成。最新中央（当前已知 90bce686 后继）尚未吸收本树，后续须精确保护 WIP、核交集并验证受影响门；本片未推送。

原相关 117、15 browser wrappers/20 场景及 26 native 每项跨轮实际 PASS 仅按原同源收据桥接，不称本片新跑这些矩阵。独立全文材料观察已收束于 `/private/tmp/jg-382-task10-full-material-physical-20261107/FINAL-FULL-MATERIAL-OBSERVATION.md`（checkpoint c677c08d…951948）：94 多行 25pt、839 glyph keys/两侧8352可资格字符及可见局部 frame 有限通过；60 单行 linebox、8 script 选择及无可见 paint 等维持不可观测，不自动扩成新强制探针门。临时 Vite sidecar 仅为本机验证证据，不另造跨平台 CI 或安装 Word 的硬门。整票双轴、范围提交与独立整合另行完成。
