# Task16 B8a AuthRateLimit ACL源码与模拟收据

准确基线 `6310fa20eff0513a9cd9cbbdb276bdc2a243bf60`；独立树 `/private/tmp/jg-382-task16-rate-limit-acl-20261108`，分支 `codex/enterprise-task16-rate-limit-acl-20261108`。未提交/推送/合中央或main。Git worktree创建及含原合成Git fixture的离线回归经正式require_escalated；没有项目提交或remote写。未来所有commit/finalpush HEAD必须 `[skip ci]`。

## 范围与源码依据

用户已确认的安装/角色隔离source/mock范围，由主控明确映射本片原public run/resource及B7自有fake CJS protocol；无新公开、物理、OS或Nest工厂接缝。计划 `/private/tmp/jg-382-task16-B8a-rate-limit-acl-plan-20261108.md`。仅改Task16 profile、安装SQL、共用checker/固定profile资格及两测试，不改产品Auth实现/Schema/迁移、七prepared SQL或B7产品源码，不碰旧B7作者树/中央/Task10。

真实AuthModule六guard仍保留；AccountRateLimitGuard对POST /auth/login调用原服务。`auth-rate-limit.service.ts:29` deleteMany只使用expiresAt谓词；34–36按key upsert，create三列、update仅hits increment，默认返回三scalar；Schema109–114恰key/hits/expiresAt且无需sequence。AuthModule/service/guard三份准确source hash加入profile，原39 pins不变，现42。

## 最终改变

- final runtime profile和delta新增AuthRateLimit列级SELECT/INSERT(expiresAt,hits,key)、UPDATE(hits)，不授key/expiresAt更新或REFERENCES；before不含Auth权限，observer原11表和所有权限不变。
- runtime内明示 `technicalAuthRateLimitDelete:true`，因此DELETE例外进入同一expectedMatrixSha256（不是不入证明的外部自报）。源码资格只接受固定runtime、精确一行Auth列清单/唯一delta，无before/observer技术标志或Auth行；新Auth非空REFERENCES清单亦拒绝。
- 安装事务仅新增字面固定 `GRANT DELETE ON TABLE public."AuthRateLimit" TO jg_task01_runtime`，无grant option、GRANT ALL或baseline reset。**DELETE为该技术表的表级权限，不能声称DB ACL只允许WHERE过期行；expiresAt谓词仍由原业务服务负责。**不引RLS、SD代理或改限流算法。
- 共用checker把DELETE从table-level ANY列表独立出来，所有关系逐项 `IS DISTINCT FROM expected`；expected只能是final_stage + 固定runtime + 精确public.AuthRateLimit OID + heap表 + sealed boolean。before/observer及其它关系的DELETE必须false；table级SELECT/INSERT/UPDATE/TRUNCATE/REFERENCES/TRIGGER仍统一拒绝，原逐列矩阵继续执行，不跳过整张Auth表。
- B6安装和B7客户端使用同一新profile/digest及唯一checker。PUBLIC、grant option/default ACL、otherGrantee witness、OID/source/首份资源、四paired guard、7表/17函数owner及全部44函数proof不变。其它grantee不因Auth表被整体排除；只有原来明确排除的runtime/observer角色不纳其它grantee witness，其本身由完整矩阵校验。

## 公开模拟与红绿

外部证据 `/private/tmp/jg-382-task16-rate-limit-acl-evidence-20261108`：

- `rate-limit-grant-red.tap` → `rate-limit-grant-green.tap`：原公开run实际registered stage交给owner adapter的wire原缺精确Auth列/显式矩阵标志/唯一字面DELETE及严格checker条件，最小补后通过。SQL只构造并交给mock，未解析或执行；字符串观察不被升级为实际权限证明。
- `rate-limit-reference-red.tap` → `...green.tap`：自有sealed fake候选中Auth多REFERENCES(key)，原新增资格只核select/insert/update会放过；补空/缺失REFERENCES资格后在零owner SQL前拒绝。仅该新技术表scope，不扩通用框架。
- `profile-continuity-first.tap`为必要回归阶段的8项通过/32按窄pattern未运行，非完整总数。自有fake候选通过原run连贯调用实际B6+实际B7 stage，确认同一profile/checker wire及digest。七种非法合成profile（缺runtime技术DELETE、observer/before误启用、扩大key更新、缺返回列、额外REFERENCES、observer读取）均在SQL前拒绝并关闭owned mock资源；旧pre-limiter matrix digest也在B7拒绝、零client构造。
- 完整 `full232.tap`：旧222全部保留 + registered wire1 + clients连续正控1/非法profile7/旧digest1 = **232/232，零fail/skip/cancel**。`cli25.tap` 原25/25；API `types.log`/`src-lint.log`退出0，三受影响CJS `syntax3.json`/`cjs-lint.log`退出0，JSONdecode/diff通过。`preserved-contracts.json`与逐项hash核实原39/新增3 sourcepins、全部44函数、before/observer、EXEC/guard及legacy owners未漂移。

B7测试fixture仅复制必要实际stage到自有私有fake候选、按既有合成source协议封存（不构造真实source authority），客户端仍无副作用FakeClient；不加载共享真实Prisma/SDK、不启动Nest/listener，不查实际PG或业务记录。原222中的负矩阵/其它ACL漂移/未知提交及finally协议回归保持，但它们也不是PostgreSQL权限反例实跑。真实DELETE/TRUNCATE/PUBLIC/grant-option及逐列拒绝需要未来真实PG门。

所有初始前像见 `6310-before-images` / `before-images.json`（7已有文件，新本收据原不存在）；原RED日志不覆盖。最终8路径hash/验证摘要见 `freeze-manifest.json`，独立双轴待主控。静态依赖链接仅在ignored API node_modules，未安装或提交依赖，不作native runtime闭包证明。

## 未满足的门

SQL_NOT_EXECUTED_NOT_PARSED；真实Auth登录限流/过期清理、SDK/PG/TLS/ACL/锁/negativeDML/COMMIT/响应丢失/竞争及物理清理/资金未验。ACL源码前提不等于App已可运行；default仍缺App/seed/case三stage、资源前拒绝。未使用新的Nest工厂接缝、未伪App origin或seed合法assignment；#398 OPEN、17/24与16/42/44硬门、13/45保持。无main、部署、生产、实际交易或通知。
