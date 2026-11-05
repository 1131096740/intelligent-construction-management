# 任务07本地实现与准备收据

执行日期为2026-11-05～2026-11-06（Asia/Shanghai）；任务/证据文件名沿既定20261105。工单[#389](https://github.com/1131096740/intelligent-construction-management/issues/389)，从准确中央cd156be31f542baf62d43f2deb0b5fd6f9558882建立独立工作树，已快进合入中央054bcce73419e02e841d3c57c36a46fcdcf65ed4（纯状态文档，不改业务测试字节）；候选准确SHA由外部交接指纹登记。本地实现待独立Standards/Spec复审、主控整合；本收据不宣称GitHub已关闭、远程CI通过或发布资格。

## 范围与逐项验收

| 规则 | 实现与公开证据 |
| --- | --- |
| IAM09三岗项目基础资料 | ProjectService以当前启用账号及真实全局岗位解析董事长/总经理/综合主管；独立project.basics.manage仅用于创建、改名、列表与预检。ProjectController实际loopback HTTP验证三岗正控、技术管理员/其它岗/停用/项目级伪同岗负控。总经理不获得单位或施工企业配置/停用能力。新建/修改保留原业务快照与审计。 |
| 同名仅核对、编号唯一 | 服务预检返回非阻断warnings，编号唯一约束不改；实际ProjectCreateForm/ProjectRenameForm首次显示核对，第二次确认前重读服务器capability，失权拒绝。编译真实组件+真实领域API transport测试，不只断言常量。 |
| IAM10唯一施工企业、多我方公司 | 复用ProjectAffiliateAssignment、现存唯一partial index与父项目锁；不新增更正入口/Schema。现有affiliate-management/operating-period与project.service回归保留重复、日期/并发冲突翻译和多公司行为；实际表单选择器可搜索现档且提交versionId。无档仍由单位维护两岗先建，普通填单名称不写档案。真实PG约束竞争尚未执行。 |
| IAM11项目人员 | 项目经营“项目人员”只读真实Roster接口的当前可见项目人员/岗位，无手机号密码；入口去既有员工管理并带projectId，共享ProjectRoster调入调出功能保留。实际组件验证筛选、名字、链接与无编辑控件。 |
| IAM11工程完工 | 复用availableActions/capability及ProjectCloseProfit.completeStage的construction_completed首stage；未将isActive停用，未改余六金融stage算法。project-completion-public实际ProjectCloseProfit/OperatingProjection/Visibility/Settlement/PaymentRequest服务在同合成DB完工后仍可读历史、发起结算与付款；跨项目负控仍拒绝。 |
| IAM12单位维护与历史 | 沿CompanyEntity/BusinessParty原入口，仅董事长/综合主管实际全局岗位且账号启用可维护；其它岗/技术admin负控。有引用公司可停用，保留旧CompanyEntityVersion、合同签约snapshot，停用审计真实记录hasExistingBusinessReferences（不硬编码）。新选用仍active校验。 |
| BAS04关系文案 | 项目经营明确表内/表外/我方对上及业主与施工企业单独关系；原金额、合同网格、模板与金融算法未改。 |

## 用户补确认：目录停用仅阻新选用，可靠旧单继续

用户明确选择“仅禁止新选用，旧单继续”，并确认付款申请/应付核销代付public HTTP/公共服务、syntheticDB/账户网关测试边界；不是只验空档案停用。

- PaymentRequestService：锁定原批准/部分付款申请、合同/项目/原签约CompanyEntityVersion及真实服务端bank observation。原主体目录停用时只沿可核冻结主体+有效验证来源继续；有/无可选payerAttestation两分支均不能用客户端allowInactive旁路。独立银行核验人、证据文件/hash、当前权限、余额/占用/版本与幂等检查保留。
- PayableRegistryService：已确认WagePayable及原已实付request/execution/attestation/reauthorization精确来源继续核销，包括原债务A停用、已实际支付B停用的合法代付；未批准来源、无冻结版本、主体冲突、已撤销核验、跨项目均拒绝。候选GET和实际confirm均有公开正控。
- FundExecutionSelectionOptionsService：存量FundExecution+Claim+VerifiedObservation已固定真实付款主体B，只待分类时不视为新选档案。与原已确认债务A及当前验证证据匹配才返回可办理候选并解析原opaque selection；B≠A合法已实付代付可继续，缺Claim/金额来源冲突/草稿债/核验撤销拒绝。未改四轴后果算法。
- 普通未付PaymentRequest只冻结原合同A；现有reauthorization metadata不含真实B权威，不把它猜成已冻结实际付款B。没有既有真实B来源时，事前新选inactive B继续拒绝；不新造批准B流程/Schema。
- 真实生命周期核对：statuses.ts有effective/superseded，ContractVersionActivationService补充/变更激活时将原effective改superseded；confirmed历史接管写effective。原已批准/实付冻结来源可沿effective或superseded继续，draft/voided/项目不符拒绝。新合同/新结算仍沿原latest-effective规则，不升级草稿版本权威。公开付款HTTP、核销confirm及opaque候选的superseded正控均先RED后GREEN。
- 本仓账户权威是现有PaymentExecutionPayerVerification+银行观测/证据，尚无通用账户停用模型；未伪造实时银行有效性。实际账户容器、银行送达/实时有效性与真实资金门仍由16/28/42/44在获授权后验证。

### 保留的新选择active门与存量覆盖面

| 当前门 | 实际时点/结论 |
| --- | --- |
| CompanyEntity.listActive、项目新公司绑定、合同首次签约主体/编号规则、未确认采购/工资新主体 | 新业务/新绑定选择，继续拒inactive；不改旧版本。 |
| InvoiceLedgerService.createGlobalInvoice的owningCompany | 新独立全局发票登记，不是已有发票/旧付款继续办理；active门保留。 |
| ExpenseClaimService.adjustPaymentSubject | 已批报销重新选择不同实际付款主体；同主体拒绝“无需调整”。原冻结主体付款执行不做目录active拒绝；新主体active门保留。 |
| SpotProcurementPaymentService.confirmPaymentMethods | 既有冻结payer补历史方式或补snapshot已有专门兼容分支；正常已办任务拒重复。财务重新审批调整主体仍属重新选择；active门保留。 |
| 本次已授权PaymentRequest实付/Payable核销/Fund存量候选 | 原active-only阻断已适配到可靠原来源，未发现仍仅因目录inactive阻断的合法旧批准/实付来源；来源不存在/不唯一/不可靠仍失败关闭，不把这类拒绝伪称历史数据验收完成。 |

## 前置05接线缺口在07重派生时发现

原中央user-fill生成物仍ready且88 retired，但真实route-usage已将ApprovalDelegationController.create/revoke恢复为active；全局RetiredWriteEntryGuard仍拦这两项。原静态369出现368通过/1失败（POL23_LEGACY_WRITE_CLOSURE_INCOMPLETE），user-fill原生成器给2 stale。未改工具、未加豁免。

主控明确授权本票最窄补修。真实Controller+Service+全局Guard loopback先RED：合法create预期201实际410、本人revoke预期200实际410；业务handler之前被守卫拒绝。仅移除两项过期退役登记，业务scope/权限/期限/审计未放宽；真实HTTP现create201/revoke200、越权403、过期400、重复撤销400，5套原关联54项通过，其余86 retired精确保护保持。05须由主控以新准确SHA重新收口，不以旧closed历史冒充当前完整通过。

## 验证结果与命令

所有命令显式私有workdir并先断言resolved cwd；受影响Jest最终一律--runTestsByPath明确源文件，无PG spec。

| 检查 | 结果/外部原始日志 |
| --- | --- |
| API受影响22文件显式Jest | 1009/1009；/private/tmp/jg-task07-api-affected-final.log（完整源文件命令在末行） |
| superseded最终财务3suite | 273/273；jg-task07-financial-lifecycle-green.log |
| 前置05委托+退役守卫5文件 | 54/54；jg-task07-delegation-guard-green.log |
| Web真实组件/领域API 3文件 | 5/5；jg-task07-web-affected-final2.log；Vue动态控件未覆盖分支有t-textarea resolution警告，当前断言经过真实输入/确认/失权链 |
| API typecheck/lint/build | jg-task07-api-types-guard-final.log、jg-task07-api-lint-guard-final.log、jg-task07-api-build-guard-final.log |
| Web typecheck/lint/check:ui | jg-task07-web-types-final.log、jg-task07-web-lint-final.log（0error/760warning）、jg-task07-web-ui-final.log |
| 原7组治理unit | 231/231；jg-task07-governance-unit-final.log |
| 原metadata生成/ready、原静态369 | 全链退出0：702路由/656wrapper/695绑定/397动作/0阻塞；86 retired精确闭合。原编排369/369、0失败0跳过，jg-task07-static369-green-final.log；首次368/1仍保留 |
| 原PG manifest静态CLI | --validate-manifest，executed:false；23组78文件523逻辑场景，CI22组77文件522、manual1。逻辑登记数不等同Jest实际it数。 |

原命令族为pnpm --filter @jiangkong/api exec jest --runInBand --runTestsByPath <日志中的明确文件>，pnpm --filter @jiangkong/api typecheck/lint/build，pnpm --filter @jiangkong/web-admin typecheck/lint/check:ui，原node scripts/inspect-whole-site-*及inspect-user-fill-entry-inventory的--write/--check --require-ready，node --test原7治理文件，pnpm test:ci-orchestration，node services/api/prisma/run-database-dynamic-gate-local.cjs --validate-manifest。没有--execute。

### 保留RED与旧fixture因果

- superseded原批准付款409、核销Conflict与候选空集合的RED分别保留jg-task07-superseded-source-red.log、jg-task07-superseded-candidate-red.log；只扩大曾生效来源状态，不改新结算版本规则。
- 同名表单首次无核对RED保留jg-task07-duplicate-warning-ui-red.log，GREEN为实际warning确认链。
- 首次API命令误用src/project regex，3失败1跳过56通过：5失败为两个CompanyEntity状态审计新增真实hasExistingBusinessReferences字段、两个项目能力动作project.master_data.manage→project.basics.manage，以及affiliate日期拒绝夹具缺启用actor。分别补准确审计预期、仅两处基础能力动作、有效actor夹具；原快照/角色/日期拒绝不弱化。jg-task07-api-affected-first.log及affected-repairs-green2保留。该regex确曾收集一个既有project-close-profit.http.pg.spec.ts跳过描述符，未运行hook/case、未设RUN/资源；之后只用明确文件，不宣称从未收集PG文件。
- 一次范围过宽的测试常量替换误改七条原binding断言，失败后只恢复这七条master_data预期，原业务guard始终未改变。各首次失败日志保留。
- PG静态manifest首次错读groups键无写入；后续GROUPS小计及selected payment旧1预期逐项改为实际2，70/70静态GREEN保留，不运行PG。
- 前置05全局Guard的两次RED和原368/1保留：jg-task07-delegation-global-guard-red.log、jg-task07-delegation-global-guard-valid-red.log、jg-task07-static369-final.log。

非Markdown修改路径冻结指纹为53de9ef427890839f3db4524daa78a1f90d4a69452e7ef5e849cea02308a31fc，逐路径SHA-256与所有原始日志哈希见外部jg-task07-precommit-fingerprints.json / jg-task07-final-handoff.json；不自引用尚未生成的提交号。

## PG仅准备、未执行

原RUN_PAYMENT_EXECUTION_CONCURRENCY控制的payment-execution-concurrency.spec.ts新增1个integrationTest：停用有业务原公司后，原批准付款剩余额度/幂等/资金不足原竞争断言。原RUN_PAYABLE_SETTLEMENT_DATABASE控制的payable-settlement-concurrency.spec.ts新增1个it：原债务与真实已付代付公司停用仍沿原服务核销，守恒/授权/核验不弱化。两个新增it均接原runner且默认关闭；manifestpayment_execution1→2、remaining_dynamic_postgresql16的payable19→20，组小计158→159、总521→523/CI520→522，组/文件数23/78不变。没有增加CLI selector或拿内部ID冒充入口。

真实PG、198迁移应用/约束竞争、真实短信/对象存储、实时银行/资金容器、真实浏览器持久业务链、部署及生产写均NOT RUN。合成DB/loopback/编译组件与静态登记不能替代16/42/44硬门。

## 执行事故

本轮曾遗漏workdir并对原根两份payment-request文件read_text/write_text，确实触碰mtime/ctime。主控独立核当前两文件SHA-256/Git blob等于更早基线；没有即时beforeimage或原mtime，不能说原根从未写入/完全未变。没有逆改原根、恢复时间戳、吸收其业务diff。详见[事故与独立证据](2026-11-05-enterprise-simplification-task07-workdir-incident.md)，独立JSON SHA-256为6127833b16e68712db0aa85ac94b693521c572c3dc2947775834e1b3c60723c7。恢复后每次写/build/日志均明确私有cwd断言、绝对目标，Git显式-C。
