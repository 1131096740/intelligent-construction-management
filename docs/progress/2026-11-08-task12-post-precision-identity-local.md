# A1 增量修复（2026-11-08；以下A0收据完整保留）

原A0完整20/sourceSet5949068b与双轴报告（Standards036d9f7c、Specd4940250）保留。仅修两个确定P2：当前签约版本和项目加入版本分别为独立快照，参与查询去掉companyEntityVersionId=currentVersion条件，保稳定companyId/唯一/半开期间，当前版本选择复核不减；Date列改用shared chinaDateOnly(occurredAt)的北京日UTC零点参数，identity保真实occurredAt并另记businessDay，不改旧全域日期政策。

实际证据同外部目录：identity-A1-participant-version-red.log（current-v2/open-participant-v1公开POST400，预期201）→同green1pass/3未选，参与v1原值未改；identity-A1-beijing-date-red.log（凌晨开始误拒/停止误过2fail，普通时段2pass/3未选）→同green4pass/3未选。控制仅在测试进程fake Date时钟，loopback异步定时器真实，finally恢复；不新增生产DI/私helper测试。

identity-A1-final-regression.log实际8suite519passed/520total，1原既有真实PG门skip；identity-A1-typecheck.log与identity-A1-lint.log各exit0，diff0。原20路径范围不变，只有helper/spec两TS与两MD形成增量，其余16路径逐字保持；正式冻结当前公司/正文R_F、原guard/并联/自审签字/撤回/盖章/旧入口权限控制保持。最终20源+相对A0四路径delta、203/依赖守卫在外部identity-A1-freeze收据，不把A0旧测试当A1重跑。

边界仍旧：源码/模拟测试不是真实PG/SQL/COMMIT/锁并发证明。无Schema/204/生成SDK/安装/网关/资源/commitpush。原HOLD/其它树不改；后继204物理提案仅另存外部草稿并暂停，未完成提案不能实施。

---

# Task12 后精度表内主体冻结首片本地收据

2026-11-08。本树 `/private/tmp/jg-382-task12-post-precision-20261108`，分支codex/enterprise-task12-post-precision-20261108，准确base2b69621a5c3ef990f7dca44faa11d82e973f781d/tree0c364c817bb4cabb7ed8f57d16ee456f22496b55。仅局部源码/模拟验证，HOLD待双轴，无commit/push/合并/生产动作。

## 前像与依赖

原Task12 A2 d74716源在旧563树继续冻结；新base逐前像复核12原有与4新增后准确承接，不复制旧PROGRESS。证据 `/private/tmp/jg-task12-post-precision-evidence-20261108/carry-forward-16.json`。来源07b0干净私有203依赖只COPY，56358普通文件/2467链接，287已审SDK/generator/shared成员SHA与mode相同且新inode，四binding均在新树，shared68产物相同。source/central全依赖manifest前后不变；不安装/生成、不构造真实PrismaClient、不连接PG。copy receipt及全manifest在同外部证据目录。no-engine仅TYPE/source资格，copyEngine=false，不是原生运行资格。

## 真实来源与局部行为

新增合同专用 `contract-v2-signing-identity.ts`，仅inside。CompanyEntity选择来自原公共保存接口的server selection；同TX复核选中id/current版本/active/complete、真实版本信用代码/地址等及同项目/半开日期唯一参与关系，锁住公司和参与行。正式设置our_company及完整公司版本快照、清空affiliate组，再冻结submission.versionFacts；不是先冻结draft_unconfirmed后改状态。金额未知仍NULL，正文R_F不被后台改写，旧轮snapshot/签字/文件不覆盖。

角色沿真实 `ContractDocumentService.renderValues:1255–1302`：editable选择公司→party.party_a/party.owner，覆盖旧CPS party_a。首public getDraftBody确证甲方显示所选公司；后冻结同一CompanyVersion与相同R_F，submitted renderer走已有frozenCompany分支。不新增companyEntityRoleKey/重复用户选择；探索期间本人choices差异已撤回，workbench.service.ts最终无delta。六角色catalog不作为普遍债务主体推断，不向outside/upward外推我方甲方。

原Task12长链夹具改为真实inside公司选择/参与来源，不再以未闭合upward来源冒全关系；不改Task09/10共享helper。独立fake持久层仅补现draft_unconfirmed CHECK的字面oracle、company/参与表和有限锁投影，没有SQL解析执行。校验原件：20261106090000迁移只允许draft_unconfirmed处于draft/abandoned且firstSubmittedAt/effectiveAt皆NULL。

## 红绿与当前结果

外部证据目录 `/private/tmp/jg-task12-post-precision-evidence-20261108`：

- identity-first-red.log：夹具TS2367，0test，非业务RED。
- identity-second-red.log / identity-save-diagnostic.log：公开保存400未知角色字段；收窄为原renderer角色权威，保首次探索失败。
- identity-constraint-red.log：真实Nest POST /submission500，异常精确“合成持久层拒绝未确认签约主体进入正式状态”，stack v2submission旧169；这是独立CHECK实际RED，不是实际PG失败。
- identity-first-green-attempt.log / identity-existing-role-green.log：分别夹具TS2304及有限锁参数拒，未冒业务通过。
- identity-first-green.log：首inside1pass/2按名未选，非全回归。identity-lifecycle-regression.log后3/3通过。
- identity-final-regression.log：8suite，516passed/517total，1原有RUN_CONTRACT_ROUTE_CONCURRENCY真实PG门skip，无新增skip。并联各职责/自审密码/签字/委托/撤回后全重审/旧轮证据、单盖章/旧seal409/retired410/v1既有控制保。追加公司当前版本/停用/参与期间变化拒且无审批轮，以及同名不同公司身份改变R/F、旧tuple拒。私有文件完整性负控日志为预期。
- identity-typecheck.log / identity-lint.log：原pnpm workspace exec tsc --noEmit与全API eslint src --ext .ts各exit0，空输出；未触pretest generate。diff检查0。金额/经营203代码未改，不复跑无变化1148当作此次证据。

## 未完成和门

本片没有归档/direct命令、upward typed桥、inline经营身份扩展或204；没有事务外COMMIT结果后验实现。后继继续受主计划853d62e、角色补充8a75510、后果v2补充2c1b0ff与领域核对约束；未启用合法0Fact和启用缺Fact UNKNOWN仍为后继设计要求，不冒本片已实现。Web/CON10真正提交consumer、cap/todo/三关系五类型完整链待做，#394 OPEN。

真实SQL/CHECK/FK/trigger/锁并发/Prisma deferred COMMIT/PG/角色ACL/下载真实环境、网关、部署生产均未执行或证明。原HOLD、money、Task16、中央及未知改动未覆盖。后续源码先双轴审，未来每commit须[skip ci]且由root指派独立整合。
