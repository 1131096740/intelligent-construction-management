# 任务16约束组合准备（WIP，不可执行）

`executed: false`。本目录不是Prisma migrations，不是可部署/可迁移候选；没有执行SQL、连接数据库、创建资源或调用PG driver。私有树已将固定中央0aa691bf6eb35e719c9f28da64e710b294c06284合入为M16 7a6204a3553584e2363b9a8d99497ea6ee7de49c（202份迁移源码），另有后继未提交WIP。此前201份基线/cb124尚未合并的叙述只属历史。七片prepared仍不计迁移；完整driver/source-derived用例库存及最终prepare/verify clean seal尚未完成，不能沿旧seal或一条未执行descriptor声明完整PG准备。

组合顺序：registered-funding.sql → registered-history-revision.sql → registered-write-authority.sql → registered-canonical-proof.sql → registered-intercompany.sql → registered-canonical-adapter.sql → registered-voucher.sql。最终只能经过静态完整组合复核后合并为一份受控迁移源码（单一事务），不能独立执行这些片段，也不能把写好的SQL计为PG通过。

已准备内容：

- 唯一PaymentExecution引用的资金承接、来源守恒、持久事件和唯一私有凭证child；空凭证只允许精确注册来源，原Execution不可变不放松。
- 账户identity保持且writeRevision严格+1的唯一CAS例外；核对覆盖集合插入时存在/同账户/唯一，之后沿15原终态冻结；原source终态zero-append守卫保持。
- 账户容量从最新confirmed核对减去未覆盖的正式分摊；新付款不自动被待审核对吞掉。来源祖先唯一时核容量；拆分多后继或缺归属时只保留待核对状态，不双扣、不FIFO、不创造到账/垫资/本金变化。
- canonical Fact实际付款角色单项精确证明，POL284其余五角色不豁免；保留Project→participant排序锁、10月原债归属日及工资/反冲销等原函数后续补丁。现金仅actual_payer、同canonical source/impact金额/方向/键。
- 代付根是同Execution的既有InterEntity后果，精确A欠B/原快照/项目/合同/版本/金额/源/actor；旧银行、一般代付、工资、返还、v7 canonical manifest与transfer reservations保持。NOT VALID旧约束标志保留。
- 私有凭证使用现file binding registry wrapper扩展，不复装旧registry；同业务行→统一file advisory→FileObject锁序，哈希/实际上传人/active/独占绑定。child不改Execution、来源version或原frozenSnapshot。

仍须完成：完整最终定义静态组装与DDL/Schema对齐复审，真实PG可运行用例/驱动及source-derived库存，异常/响应丢失/并发独立期望。所有SQL语法、触发器执行顺序、COMMIT行为和并发均未实证，不以应用合成GREEN代替。

## 待单独授权的资源实验

仅准备具体计划，不触发资源：

1. 完成单一迁移及PG用例后，在干净合并固定中央候选运行现有 `node scripts/prepare-enterprise-acceptance.cjs --prepare --output <packet>` 与 `--verify <packet>`，记录确切HEAD、argv、packet seal、源码/迁移/用例/driver SHA。当前WIP不运行此门、不预填SHA。
2. 由主控明确授权独立本机PostgreSQL16容器/volume/loopback端口、专用数据库、全部迁移执行及仅合成数据。复用仓库既有money-bigint-runner-runtime/cleanup工具约束，不触碰任何已存在未证明归属的容器或volume，不访问远程/生产/银行/COS。
3. 新16专用HTTP/公服PG driver尚未完成，不能给不存在脚本伪可执行命令。既有 `run-payment-execution-concurrency-local.cjs` 证明旧bank资金路径，不能直接冒充新RegisteredFunding链通过。旧fund-account-postgres.spec.ts在既有dynamic-remaining PG16库存，原15全部zero-append/终态反例继续保留。
4. 正常实付后，用独立PG连接检查事实/请求剩余/核对余额与来源/正式往来/OperatingFact及Impact/审计/事件一致。注入提交时DEFERRED约束失败，HTTP不得成功、所有业务零写；断连/丢响应以外部传输代理丢弃成功响应，独立连接先核事实，再原key查询/复用，不能双扣。不得用mock transaction callback代替COMMIT。
5. 两个独立客户端/真实会话并发：同申请100各付60只有合法一笔，账户100跨申请各60防超余额，原key同内容收敛唯一fact/事件/审计/往来，换key或内容漂移明确拒绝；用真实锁等待/独立连接观测，不仅Promise同进程冒充竞争。
6. 反例至少包括：B仅actual角色合法而同时被填为debtor/approved/cost拒绝；精确ID但换project/account/registration/金额/冻结身份拒绝；自报registered标签/legacy NULL evidence拒绝；B40+A40后剩20再21拒绝；split100→50+50未覆盖30总70且不各扣30；核对100待审新增30确认仍70；唯一child只改read overlay，原Execution/OperatingSnapshot/sourceVersion不可改；旧15三个终态追加0行仍拒绝。
7. 所有失败保留源argv/退出码/输出SHA，独立审查资金轴与规格轴。容器/volume清理须按原归属证明及授权，只清本实验新建资源。真实短信/银行/COS、真实交易、部署和生产写不包含在该PG实验授权中。

#### 尚未闭合的领域/批准写时资格（续接核对）

当前应用层已共用严格我方冻结版本与真实工资关系领域判据，最新批准轮的写前授权已具合成HTTP反例。此目录现有SQL尚未完整对齐该组写时资格，不因应用用例通过而视作可迁移。永久canonical来源证明必须保留原正式事实可重放，不能直接依赖日后可变的latest审批轮；写时资格与冻结来源证据的具体约束组合仍需完成源码并独立审阅。工资首次专用写退役归43/CUT-04，本票不制造新的工资分类事实。以上均未执行真实PG。

写时资格/冻结Event坐标/永久replay的详细边界及8组未执行反例见[write-time-authority-plan.md](write-time-authority-plan.md)。该文件是待实现设计，不是DDL或driver，不改变本目录不可迁移/未执行状态。


## 写时权威源码后继（未执行）

registered-write-authority.sql现已补写：历史完整集合锁定/固定顺序JSON字节重建及服务器basis结构比较；当前公司岗位、真实我方版本/同合同、工资互斥、唯一当前批准轮及Event冻结坐标；写前/提交前分别核申请容量与唯一累计后果；07停用原责任主体冻结身份与新增停用代付主体区分。原唯一审计守恒还核责任主体、实际主体、日期、资金归属与前后状态；账户CAS和Execution均需本事务写入。没有放宽旧FundMovement公司/项目约束或重装旧canonical函数。

应用Event生成已随approval559799…/funding14ca7b…改为服务器同事务读取正式坐标与批准轮、冻结原请求容量；这两文件变更后尚未重跑56/类型。此前完整56/类型/lint收据绑定其旧source，不能外推。

JSON编码特别待真实PG验证：SQL未用jsonb::text代替JSON.stringify；它按d0a6服务的固定字段序显式拼接to_json字符串、UTC存储毫秒日期、NULL及相同记录排序，独立重算public.digest，再将整个basis结构作相等比较。此同构仅为源码设计，尚未证明实际PostgreSQL字符串转义/时区/排序与JS逐字一致。多条相同createdAt最新轮源码暂明确失败关闭，未靠UUID伪造顺序；其与旧数据/公开谓词的兼容仍是独立复核与真实PG反例，不能宣称已有迁移资格。

永久canonical proof只绑定成功时冻结的Event坐标及真实身份，不复查未来latest/岗位/历史basis，不让后续合法核对变更反向抹去付款。冻结JSON不是第二账本，不新增历史实付或按日期推历史成员。本目录仍SOURCE_ONLY_NOT_EXECUTED，不是可promote迁移。完整组合顺序、语法、触发器/锁时序、故障和竞争尚未执行或验收。

### 最新应用验证补充（不等于SQL执行）

上述authority源码后继已进一步统一同时间最新轮拒绝（approval6a9a/funding14ca/factoryc478）；当前7套相关API534及类型/完整lint通过，精确收据另封。旧段“尚未重跑”的描述属于先前阶段，已由本补充更新。prepared SQL仍未运行；应用用例不能证明SQL JSON字节/哈希、语法、锁或提交安全。共同批准谓词现与prepared的同时间多轮失败关闭方向一致，实际PG竞争仍待证明。

### 完整历史集合并发：不可略过的硬门

当前 per-row FOR SHARE 不能锁住新增 confirmed 历史成员，现有所有历史写者也未建立统一父版本协议；仅写 Serializable 不构成证明。具体只读事实、修订后的 NOWAIT marker 锁序方案、Prisma/DDL待对齐形状、触发器矩阵、revision纳指纹、权限安装条件与双连接实验见 [history-set-concurrency-plan.md](history-set-concurrency-plan.md)。当前应用冻结，marker 尚未落 active Schema/app/生成client；本目录原SQL也尚未实现这项协议，不因前述来源/审计约束源码齐备而可promote。

### marker 应用及SQL组合后继（仍未执行）

active Schema a779新增专用technical revision与Contract逆关系，纯生成5.22通过；应用519/30eefa/7bd/5d6、factoryed349的新公开组61及类型/完整lint通过。SQL现已接入NOWAIT marker、完整revision+records指纹、Event写前/提交时revision与basis、永久proof仅冻结revision不读取未来marker；此前“尚未接marker”的描述由本段更新。这里仍不是SQL已运行或可迁移结论。

安装顺序必须在同一受控事务按上述组合，并使用固定public search_path；owner/runtime预先具备原应用所需普通表权限/默认ACL，随后marker安装器显式清除其全部非owner直接权限、仅授readonly与SECURITY DEFINER lock API执行权。不能在安装器之后再用GRANT ALL TABLES把marker权限加回。实际登录角色、旧表ownership、默认ACL/继承关系均未验证，安装参数缺失或runtime拥有watched历史表会失败关闭。

时间编码与非UTC session向量见[timestamp-and-json-vectors.md](timestamp-and-json-vectors.md)。当前实际Schema列为plain DateTime默认timestamp(3)，SQL独立preflight校验；两种native类型重载分别处理timestamp与timestamptz，未依赖当前session碰巧UTC。完整SQL语法、逐字哈希、权限、锁序、Commit与并发仍须独立PG验收，所有片段SOURCE_ONLY_NOT_EXECUTED。

### 独立窄审后两项源码修正（未执行、待增量复审）

跨公司B代A的“缺席根/影响”已补总延迟守恒：Funding、Allocation与Event共用的deferrable检查在完整同事务图上要求唯一A欠B正式根、对应同源canonical Fact与唯一精确proxy impact；同公司及公共现金不得产生此根/影响。写前来源身份与root BEFORE验证保持不要求自身尚未插入的行，不把完整后果门放进永久source_matches，也不补造任何财务事实或旧数据。

7片新权威函数均固定运行search_path为pg_catalog,public,pg_temp，关键关系/复合类型及自定义helper显式public，catalog helper显式pg_catalog。动态patch仍只命中原精确锚点并保留旧业务体；仅对被patch及新voucher直接复用的既有权威函数补运行路径，不批量改旧表ACL、不修改POL284/工资/v7/银行/返还/10月归属规则。实际temp/可写schema反例、pg_proc配置、运行权限与DDL/commit仍未验证。

这两项是SOURCE修正，不是增量复审已通过或可迁移结论。应用、Schema和61/476阶段依据保持其旧实际SHA，没有为SQL-only改动重复跑API或PG。


## 2026-11-07 经营轴适用范围冻结增量（未执行）
Funding新增native DATE operatingLedgerEffectiveDateAtRegistration；NULL仅表示真实存在的Project在首次登记时未启用。应用先保持payment/version→history marker→Contract/Settlement→account原业务锁；prepareFunding完成账户/来源/公司校验后，在writeRevision CAS前调用窄SECURITY DEFINER Project FOR UPDATE NOWAIT锁读API；不授runtime Project DML。Funding INSERT及Event写时复验真实native date，永久proof不查未来Project启用状态。Project profile原UPDATE与该最强行锁互斥，实际角色/ACL/锁序与并发仍NOTRUN。
跨B代A永远强制唯一精确A欠B root。非NULL时Fact/proxy仍完整必需；NULL且尚无经营投影时只跳过该轴必需性，不跳root/资金/审计/Event。若以后已有合法同EID projection，则仍全图核验，不禁止后续领域replay。不能由client bool、paidAt前后、缺施工企业档案推NULL；不制造reportingFact。新函数、DDL、原生日期、权限与COMMIT未运行，旧增量两项Closed at source不能代替本增量复审。
未来原生负例：NULL无root拒绝；enabled漏Fact/proxy拒绝；伪NULL/错DATE拒绝；缺Project拒绝；NULL后启用原key不二扣且合法投影补入不反向破坏金融proof；双方Project锁竞争与原READ COMMITTED写者双向时序。全部SOURCE_ONLY_NOT_EXECUTED，不可迁移。


## 2026-11-07 P1/P2窄审后闭合增量（未执行）
第6片为OperatingFact及OperatingImpactEntry各增加仅AFTER INSERT、DEFERRABLE INITIALLY DEFERRED入口：仅sourceType=payment_execution且真实同EID RegisteredPaymentFunding存在才调用永久complete。以后补入Fact但漏proxy会排队该事务的完整图检查；不调用未来角色/轮次/marker/Project写时authority，不改旧v7、退款/返还/更正。原UPDATE/DELETE/TRUNCATE保障来自20260814100000:510–528的protectOperatingLedgerAppendOnly及四trigger，当前正式迁移链无后续同名替换/移除；本票不另造广域禁止。
Project锁不再upfront SHARE：先原业务行与账户，校验后CAS前强NOWAIT，后续原Fact/Impact validator同事务重入Project UPDATE，消除本报告所列共享锁升级边；不声明所有死锁免除。NULL/enabled字段、Schema和永久scope proof不变，不重生成客户端。后来投影缺席/完整正控、两独立申请同项目、Project维护反向锁与错误回执均只列PG NOTRUN向量。


## source79完整图P2的源码补修闭包（仍仅准备）

完整79输入新Spec审查发现：此前提交末门主要覆盖跨公司root/Fact/proxy，未启用之外的同公司/公共现金以及资金/应付轴缺席没有完整存在性校验。旧两项窄源码审查关闭不代表本项已通过或PG已验。本轮已按已审候选将同一末门扩为所有registered Execution的完整图，不新增付款/费用事实；私有候选Spec源码增量0新项，本次应用后的精确hash复核仍待完成，所有原生案例未执行。

- **金融根轴**：冻结公司B代A始终精确一个A欠B root，即使经营日期快照NULL；同A/公共现金必须无root和proxy。
- **是否投影**：以Funding登记时原生DATE快照为准。非NULL必须有唯一原始canonical Fact；NULL且完全没有该源Fact/Impact可合法无投影。一旦后继合法追加任一projection行，就必须补齐完整同源图；不读未来Project日期，不以当前启用状态改变旧回执。
- **资金轴**：仅openingTreatment=not_included需要精确一个与冻结actual payer匹配的资金减少；included必须零个，不重复扣期初。
- **应付适用集合**：跟随正式adapter，先取本Execution的contract_due_payment行按规范sourceId聚合；不存在该行且Execution不可变settlementId非空时整笔回落该结算；其它情况为空集合而非虚构0行。contract_due且无settlement的真实应用路径总分配等于本次实付，其余路径不产此类due行。依据是Event冻结sourceType、不可变Execution.settlementId和原正数/上限/UPDATE-DELETE不可变Allocation行，不是未来PaymentRequest/Project日期或客户端bool。
- **匹配**：canonical Fact应付快照与该规范集合结构相同；每个应付影响的键、方向、金额、同Fact及其冻结payee精确相同，资金/proxy同理；缺少、多出、换轴、错金额/主体不接受。影响主体仍受原canonical引用验证器约束；本项不新增ContractPartySnapshot整体不可变承诺，也不以当前相对方目录覆盖冻结Fact。
- **后来来源行**：原Allocation UPDATE/DELETE不可变守卫保留；新增的registered-only due Allocation INSERT延迟入口复用同末门，避免初始Funding/Event触发器在后来插入时不再触发。原bank/工资/v7/返还/更正路径不进入该额外门，既有不可变及回退语义不改。

安装依赖仍为上方七片单事务顺序。完整图函数及精确Allocation延迟入口位于registered-intercompany.sql，故先于canonical-adapter的后来projection hook存在；Funding/Event延迟调用顺序不变。新的invoker helper/触发器亦必须纳入既定owner/runtime/默认ACL实际证明，未授权不执行，不以源码定义推断权限已通过。

拟追加原生反例清单只在私有候选报告中描述；不是正式driver库存、未提供伪可执行命令、未运行SQL parser或mock证明PG红绿。至少覆盖enabled同A/cash无Fact、not_included缺资金、included额外资金、遗漏/多出/错配应付、contract_due分组、advance合法空应付、NULL无projection及后来不完整/完整追加、后来非法due行、跨B唯一root与proxy。真实COMMIT故障/竞争/响应丢失及组合旧守卫仍须单独授权资源后验证。
