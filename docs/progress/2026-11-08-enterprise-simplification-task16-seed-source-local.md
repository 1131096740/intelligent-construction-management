# Task16 B9a 合法 owner fixture 源码与模拟收据

准确基线 `de7b9225a3e2edc5249bf7cc13aca418560da9eb`，独立树 `/private/tmp/jg-382-task16-seed-source-20261108`，分支 `codex/enterprise-task16-seed-source-20261108`。未提交、推送或整合；不改中央、Task10、B8a/B7/B6旧冻结树。未来所有提交和最终push HEAD必须 `[skip ci]`，原fe70自动CI事故记录保留，空checks不是CI通过。

## 授权和接缝

沿用户“确认全部，仅源码与模拟测试”的身份/角色/首败/清理范围，主控批准外部计划 `/private/tmp/jg-382-task16-B9-seed-source-plan-20261108.md`（SHA256 `9098c0f0ea7b2088b01f0e3ffdaa1f08d9b9244de05e6aebf6821a451ad5a8fd`）。本片只用原public builder、身份/fixture spec和原 `runTask16RegisteredPg(options, adapters)`：在原seedFixture stage函数中调用实际生产fixture源码，不新增直接helper测试接口、CLI或Nest工厂对象。主控另明确允许必要的一行driver有限fixtureOutcome透传。本片没有实现/测试仍待答复的完整Nest工厂接缝。

新测试仅把实际fixture TS及原信用码校验helper纯编译到自有临时目录，提供自有无副作用fake CJS bcrypt函数和Nest异常类；全部Prisma模型delegates、事务、三session query和fetch均为显式模拟，未知模型/query/route拒绝，无真实SDK/网络fallback。未导入或构造真实Prisma客户端，没有HTTP、listener、SQL解析/执行、PG、Docker、证书或资源动作。原19 spec保留历史Prisma Decimal namespace用途，与新fake包loader测试范围不同，不将它说成真实SDK连接。

## 实现与静态依据

原13个UUID增加独立施工企业BusinessParty、BusinessPartyVersion、ProjectAffiliateAssignment三ID，共16个。seed在任何await前复制计划，并复用原真实日历/日期顺序校验，拒缺失、重复、非法或跨CompanyEntity复用的身份。不会在await后把被改动输入当新基线。

原Serializable owner事务先建合成organization/active BusinessParty（无统一信用代码、normalizedName规范且独立run名）及其versionNo1快照，再建原项目和该party/version的唯一current assignment，核创建返回party/version和实际findMany current assignment关系/唯一性/时间，之后才建原effective ContractVersion、terms和Settlement。assignment从openingDate UTC零时生效；ContractVersion.effectiveAt与显式Settlement.createdAt使用同一个合成instant。没有给Settlement编造不存在的effectiveAt/settledAt字段，不依赖host now替代日期。

来源：`20260728133000_project_affiliate_subject_foundation` 的current assignment部分唯一索引；`20260814010000_project_operating_profile` 的最终lockProjectConstructionEnterpriseFromFormalFact在effective版本/Settlement上要求assignment且effectiveFrom不晚于事实日期，即使项目经营日为NULL。Settlement模型没有业务effectiveAt而最终guard会fallback createdAt。`20261106090000_enterprise_contract_v2_draft_subject` 最终our_company约束仍要求affiliate四字段为空，本片保持为空，不把Project mapping变成affiliate签约。BusinessParty/Version按既有Service/Schema合法无代码snapshot组织创建，不冒用CompanyEntity或CompanyEntityVersion。

保持原公司B付A、项目经营未启用、预审批状态、无voucher和零经营分录case；不改case ID/handler/expectations、不启用经营账、不放宽guard、不加runtime/observer权限、不改产品Auth/Schema/202迁移/七prepared SQL。B5/B6来源pin仅fixture hash及B5 JSON digest依赖级联，角色矩阵/44函数/四paired guard/7表17函数owner/otherGrantee ACL保持不变。

## 失败与模拟证据

证据目录 `/private/tmp/jg-382-task16-seed-source-evidence-20261108`，保留所有失败日志与原始前像。

- `plan-red-assertion.log` 原builder13身份而要求16，`plan-green.log` 最小GREEN；早先一次工作目录错误和bin相对依赖路径错误留在原日志，不冒断言RED。
- `owner-red-actual.tap` 原public run实际调用fixture源，明确缺BusinessParty记录；`owner-green.tap` 补owner链后通过。之前路径资格setup失败 `owner-red.tap` 也保留。
- `plan-alias-red.tap` CompanyEntity/party身份复用原会通过；`...green.tap` 新计划资格在零owner事务/HTTP前拒绝。
- `outcome-red.tap` 原确认丢失无fixtureOutcome；`...green.tap` helper固定安全错误/driver有限枚举后保UNKNOWN。preflight/身份/计划拒绝为NOT_ATTEMPTED；owner事务一旦开始（含拒绝/确认丢失）或后继HTTP未完成，一律UNKNOWN_DO_NOT_RETRY。没有rollback/自动重试或手删保护记录的声明。
- `full-first.tap` **原232＋实际fixture source publicrun20＋driver枚举1＝253/253**，无skip/cancel/fail。新20涵盖合法全链、身份别名、party名称/active、版本归属/快照、重复/错版本/过晚assignment、非法日期/身份缺失、owner拒绝/确认丢失、login及两次opening首败、TLS身份拒绝、未知状态、跨await原计划变动。全程first failure阻止case，原driver app→clients→resource finally照常；测试case stage仅原模拟占位，正常业务handler单独由原19 spec保留验证，不能把它当真实付款已发生。
- `fixture20.log` 原19全部保留＋builder1＝20/20；`cli25.tap` 原source-only CLI25/25；API `types-verified.log`退出0，定向TS lint退出0，三受影响CJS语法及外部固定JSON config lint退出0。CJS lint最初无效CLI参数尝试留存，只有`cjs-lint-qualified.log`为成功证据。JSON/pins/diff及权限不变见preserved-contracts.json。

helper不保留原SDK/HTTP错误message/cause、token/password/URL/SQL；driver只转两个固定failure枚举，非法值忽略。资源与客户端仍由原driver拥有，seed不抢清理；模拟closed不是实际物理清理证明。

## 仍未完成

本片**不接native seed capability**：真实App origin、日期输入和实际loaded fixture模块闭包证据仍缺。默认仍缺startApplication/seedFixture/runNormalCase三stage并在资源前拒绝。实际owner seed、202触发器/事务/COMMIT、HTTP登录/openings、SDK/PG/TLS/ACL/资金/竞争与物理清理未验证。#398 OPEN、依赖硬门及13/45保持。无main、Issue关闭、部署或生产动作；冻结后等两轴独立复审，不能挪用旧pass覆盖新源码。

## v2：双轴后有限状态 getter 修复

原cf6f freeze及253结果完整保留，Spec原0，Standards唯一P2为新fixtureOutcome relay在includes校验后第二次读取属性。受控getter可第一次返回合法UNKNOWN，第二次变为私有文本；原静态值反例没有覆盖。报告 `/private/tmp/jg-382-task16-seed-source-standards-review-20261108.md`，不据该旧冻结通过整合。

原public run新增 `getter-red.tap` 实际复现，`getter-green.tap` 单次capture后校验同值修复。进一步同属性throwing getter `getter-throw-red.tap`→`...green.tap`：只在该新属性读取周围丢弃访问器异常，不把异常message/cause写进收据；保原固定failureCode和app→clients→resource finally。未泛改其它历史outcome relay。

v2 `full255-v2.tap` 为原253＋上述2＝255/255；原fixture20、CLI25/API类型/TS及三CJS lint/语法/JSON来源pin再次检查。fixture与两个profile自cf6f无变化，矩阵、sourcepin级联和三缺cap原边界继续保持。v2新增验证及哈希见外部 `verification-v2.json` / `freeze-manifest-v2.json`，新冻结明确supersedes原cf6f，不挪原253 pass冒新源码证据。cf6f四份受影响前像另存 `cf6f-before-images`；原base七份前像不覆盖。无commit/push/真实SDK、SQL、HTTP或资源。
