# 经营精度桥A3：审查修复待增量双轴（2026-11-08）

准确base/HEAD仍`d78b49905337599fa850b5693c6335f2c9ed80ea`。A2完整48源e76ca0及1145日志原件保；本次只改七个已有code/test路径和本两MD，共九路径delta、完整范围仍48路径。

1. **预检真实未变正控及真漂移**：原public真实ContractAdapter→writer→同store ClassificationPreflight.inspect实际RED。来源`numericFacts`由adapter实际协议/金额/状态生成，并按writer本有JSON持久化规则规范undefined，共用helper不抄stored、不删除stored键；同时比较顶层事实金额协议。原public inspect未变为空差异、stored金额/NULL状态/协议、numericFacts金额/状态/协议、原source内容七反例保持差异。首缺关联impacts夹具、编译/合成诊断原件分列，临时诊断已移除。
2. **追溯事实计数**：V2及旧uncapped转换同源direct0/bounded1两个实际RED，归并selected fact后补一次计数；源过滤排除项不计，截止日前已确认项不计，之后基准日归零。无现金/成本或其他算法重构。
3. **Review归属参考源码**：仅203追加`public.jg_contract_economic_review_ownership_date(public."OperatingFact") RETURNS TIMESTAMP(3)`，VOLATILE/INVOKER/固定search_path/PUBLIC EXEC REVOKE。适用源重核已确认Review/版本/唯一冻结文书和baseline/不可变originalFact的身份、协议、明确金额状态、主体及本次业务日，缺锚点RAISE不回退；非numeric2/非Review立即NULL不查业务表。只返回真实非NULL原Fact日期，不新增“原日期≤Review日”门。Fact四处原归属期COALESCE与Impact一处父归属日期SELECT用精确次数guard前置该helper，其余日期、锁、原company helper、A2两SD overload原前置核验和旧202原字节保。原public fake行为合同在SQL改前已绿：原归属日有效/Review日已结束仍保真实Review日期，原日已结束则拒，不能拿fake声称SQL RED/GREEN。

`foundation-A3-fix/final-affected-regression.log`为同34 affected suites **1148/1148、0skip**；`final-api-typecheck.log`私有203 client全API类型0，`final-api-lint.log`全API lint0，diff0。①三suite44与②四suite145是窄片实际结果，有交集不相加。最终完整源码/九路径A2前像/原base前像及守卫另封`foundation-A3-freeze/`。

203只源：plain-source witness记录原A2 SQL前缀保留、旧迁移文本四/一anchor和helper属性，未SQL parser/execute/PG。新routine+1、两旧validator定义改，无新SD/type/overload/读取表或runtime权限；Task16需核真实SD callers/owner可调用helper，不能仅凭PUBLIC revoke冒V1未受影响，完整ACL差异另封。无fresh App build/全Appmetadata、真实角色/锁/COMMIT/资源/网关/生产证据。Task12后继与中央202硬门不变，无commit/push/main合并/部署。

---

以下A2及更早是冻结历史。

# 经营精度桥A2：完整源码待双轴（2026-11-08）

当前独立树base为`d78b49905337599fa850b5693c6335f2c9ed80ea`，安全FF保46个非账本WIP及4处私有依赖绑定/287文件字节模式，原双方账本完整保留。原Task12 A2树保持HOLD。本片只是02共享经营精度桥源码，不是Task12归档或生产验收。

- 两经营表双协议：v1真实分不变，v2四位元/显式未知且旧cents=NULL；203仅源码，两TYPE/两精确overload及parent约束，无猜测生产role GRANT。已知排除来源新增contract_economic_review，仍每文书一Fact/固定reference，不开放成本、应付、资金或未知调整金额。
- 真实adapter→writer/impact→同store读取及原HTTP闭合；项目/公司/as-of/分页明细/真实密码审计CSV显式V2，默认V1纯旧body保留，不能表达新事实时中文拒绝。所有真实资金与成本仍按原分严格读取，原66条私有新client类型传播已最小闭合。
- 专业履约覆盖/Review/结算JSON四位元；真实Settlement/Coverage header仍v1分，0.0050+0.0050分项精确等于真实1分header。未知总价不妨碍明确重叠额核对，未知独立容量保NULL；已确认范围不可转移/缩减，冲回归零可重分配。纸面审批事实保留四位分项，原v1格式不变。
- 原合同未知Fact/notice不变，明确重叠0.0010由真实Review确认→replay→writer追加known decrease；总额NULL/unknown1/已知小计0.0040。baseline及原冻结numericFacts的协议/显式状态/金额键、当前Review版本/真实批准人/原Fact身份主体重核，缺键不能冒合法unknown。原v1 uncapped调整门未扩。
- 原合同source回读同时承接前版原投影排除与后续四位Review delta：2.0000−1.5340−0.0040+0.0010+0.0020=0.4650净增减，不重复/漏抵减。合法大额边界实际暴露默认Decimal精度舍入，已用局部60位计算保完整numeric(24,4)，无全局设置变化。
- V2读取只按原contract_version/downstream_contract/冻结amountNature=uncapped识别旧明确未知；原Fact/Impact/raw protocol1及兼容cents不改，V1原body控制保。V2汇总/关系cents与总额NULL、unknown计数；direct/bounded/分页detail/CSV同义，明细保raw源协议和原记录金额字段。普通旧真0仍known0，旧非零兼容delta亦不会被当完整已知承诺；cash/cost/已确认盈亏不受合同未知扩散。

最终本地验证：`A2-final-affected-regression.log`为34套原公开mock/真实类+fakeDB及本地Nest HTTP，共**1145/1145、0skip**；`A2-final-api-typecheck.log`私有203 client全API类型0，`A2-final-api-lint.log`全API lint0。前述工具失败、TS/fixture失败、各真实RED和筛选测试排除均保外部原日志；A0/A1 166/167与66条诊断仅历史，不能代本次整源。完整源码/前像/202及SDK守卫、ACL差异在`/private/tmp/jg-operating-precision-bridge-evidence-20261108/foundation-A2-freeze/`。

未做：203 SQL未解析/执行，真实PG、角色ACL/锁并发/COMMIT/回滚及资源/网关/生产未验。私有no-engine client仅类型/mock产物，不new PrismaClient/不连接；非源码tools/cache和node_modules/dist不提交。Task16 203库存/ACL/sourcepins尚由root后续独立桥接，本片不削弱中央202 gate。Task12原A2/UI/归档/生效/inline相对方/三关系及后继13/14/36/39/42/44未在本片实现或宣完成。无commit/push/Issue close/ready/main合并/部署。

---

以下为A0/A1冻结历史原记录，未完成状态仅指当时，不覆盖上方A2当前状态。

# 经营精度桥：首批本地纵向链（未完成）

本树从中央563ffd54独立准备，安全快照后FF到5da319815c8d9293c9a5598b1cbe1f585baf5bfc。原Task12 A2 16源保持原树HOLD，不混入。此记录是进行中的源码/模拟持久与本地HTTP证据，不是完整02/12/36/39、迁移或生产验收。

## A1首审P2修复（待增量双轴）

A0两轴同一P2：合法V2合同参考金额未知时，公有汇总仍整体声称“金额完整”，缺少局部提示。以原100元已确认收入/30元已确认成本/NULL合同参考fixture，经公开reduceOperatingProjection→toOperatingProjectionAggregate新反例实际RED，确认原标签不限定范围；最小仅V2汇总改为“已确认收支及资金金额完整/不完整”，notices按现未知计数中性提示“合同参考金额含未知项（1项）；已知小计为0.0000元。”。不推断具体未知原因，不要求或阻断补总价，原NULL/已知小计/unknown计数与当前盈亏70元、现金和成本不变；默认V1分支原字节保持。

外部`foundation-A1-fix/unknown-label-red.log`及`unknown-label-green.log`保实际红绿；`final-six-suites.log`六suite新167/167、0skip，`final-api-lint.log`全API lint通过。原A0 166及私有全类型66诊断原件保留；本次未扩66传播/经济review，也未重跑全API类型，不能宣称类型通过。仅reducer/其公开测试与PROGRESS/本收据四路径变化，原17源其余13及A0完整快照守恒，增量冻结HOLD供双轴审；无SQL/PG/commitpush/生产。

## 已实际验证

- 公开OperatingLedgerService真实writer受控ROW参数→独立持久适配器→新service.readFacts：1.5340元在fact+impact原样保存，cents为NULL；未知与已知0及同源重放不互换。
- 公开合同source adapter从正式版本读取1.5340元，不采用153分兼容值；净减少0.0050元经真实adapter/writer保存。未知差额使用现合法notice，不猜增减，冻结当前/前版原协议、金额状态、原amountLimitType和lineage；原v1 uncapped兼容0仍表示未知。
- 显式operating_projection/V2受类型区分。原分2元+0.0050+0.0050精确为2.0100元；bounded分页0.0050+0.0050=0.0100元。合同/evidence/source/关系摘要给四位元、已知合计及未知计数；无法表示的对应旧cents为NULL。unknown合同承诺不改变已确认收入减已确认成本的当前盈亏。
- 原公开GET项目overview显式numericProtocolVersion=2，以真实Controller/DTO/PermissionGuard、ProjectVisibility、CompanyRoleResolver和ClearingReconciliationReader执行；仅持久模型及固定raw结果使用fake。返回0.0100元；默认V1/显式1碰到v2事实明确中文400，3/02/重复数组400。V1纯旧body/金额语义控制保留。context fingerprint含协议，未发现现成缓存，不新增缓存。
- 在同一独立持久模拟store中，从两个真实正式合同版本各0.0050元（原兼容分各1）经真实adapter.readSourceSnapshot/toOperatingFactInput、OperatingLedgerService受控ROW fact+impact写入，到真实getProjectView stored mapper/bounded stream和Controller/PermissionGuard HTTP，结果0.0100元。没有为最后投影手工另塞成功结果。首次缺close模型upsert及错误复合键匹配的fixture失败分列，未冒新业务RED。
- 六相关suite共166/166、0skip；定向TS lint与diff检查通过。此数包含原public controller/service控制，不等于全API类型、全治理或真实数据库通过。

## 精确证据与失败

外部目录 `/private/tmp/jg-operating-precision-bridge-evidence-20261108` 保存各实际RED、工具/编译失败和GREEN，首业务writer RED、unknown父子不一致RED、adapter舍入RED、下降/未知方向RED、mixed及stream TypeError、V1误消费decimal seed RED、真实service400与HTTP DTO400分别保留。首次HTTP前的mapper nullable编译失败不作为业务RED；筛选测试排除数不冒全套skip。

`foundation-final-six-suites.log`是上述166实际结果，0skip；`foundation-final-api-lint.log`全API lint为0。新私有client全API类型仍有66条TS诊断，未通过，后续必要消费边界暂缓待本批架构审。

## 源码与私有生成边界

两经营表新增protocol+nullable四位元，旧cents仅v1非空；203新迁移只写源码，旧202逐SHA保持。新增V2 composite及明确cast的同名overload，PUBLIC权限撤销，未猜测生产role授权。parent同源/协议/固定承诺key/kind/主体及同绝对额；known两方向、unknown仅notice。独立fake约束不作为SQL解析/执行证明。精确TYPE/函数签名及USAGE/EXEC差异见外部 `/private/tmp/jg-operating-precision-v2-acl-delta-20261108.md`，Task16由root另协调。

私有node_modules及SDK/codegen只在新树，fixedNode20/Prisma5.22 no-engine、dummyDSN、网络/安装器/未知child拒绝器；两次global-cache utime EPERM保留，获具体授权复制已验证现成schema-engine后生成成功。仅允许已核Node generator child，没有运行schema-engine、构造PrismaClient、连接PG或执行SQL。中央依赖58759清单及旧202守恒证据分列，非源码tools/cache与私有产物不得提交。

## 未完成

全量私有client类型与必要legacy消费边界、经济覆盖/review的四位真相、company/as-of/detail/export V2及其版本边界、完整文档/双轴审/Task16 source-ACL联动尚待。Task12归档/生效与UI未回接，Task13/36/39/42/44不完成。无commit/push/close/ready/main合并、部署、资源、真实PG/DDL/迁移/网关或生产变更。
