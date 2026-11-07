# Task16 B5 基础ACL本地源码准备（2026-11-08）

独立树`/private/tmp/jg-382-task16-baseline-acl-20261108`/分支`codex/enterprise-task16-baseline-acl-20261108`，准确基线8e80a1ab2153960fc4c43c6bc209de880deb3725。未动中央/B4/B3/Task10；当前无commit/push，所有未来commit及最终push HEAD必须[skip ci]，不继承旧CI/远端状态。

角色/身份/顺序/首败清理“确认全部，仅源码与模拟测试”映射原public run+显式resource边界，详见外部`/private/tmp/jg-382-task16-baseline-acl-evidence-20261108/seam-authorization.md`及[源码合同](../../services/api/prisma/prepared/task16/BASELINE-ACCESS-SOURCE.md)。没有新增物理接口或mock CLI。stage实际SQL仅发给显式mock adapter，SQL字符串观察不是PG语法/ACL拒绝证明。

B5与七片/B6严格分开：新27 runtime/8 observer既存对象manifest附逐项源码hash/投影/predicate，future五表及两列不现在授予；restricted角色安全、CONNECT/USAGE、observer只读、精确列权限、窄identity与普通lineage helper、ContractVersion lock-only单列+runtime实际更新拒绝guard，均需catalog matrix通过。复用旧Task01仅catalog ACL展开机制，不复用其upper-bound表/列清单或完整driver。B2返回唯一已验packet全部source成员支持此manifest证据归属，不新增弱packet解析；native默认六缺减为五缺，仍资源前拒绝。

独立只读函数终态笔记`/private/tmp/jg-382-task16-B5-existing-function-closure-notes-20261108.md`指出lineage assert(text,text)及PayableSettlementCase/BankTransactionClaim读依赖，已纳入。最初将Settlement任意UPDATE混成本normal Project写的推断已独立纠正：付款将status改paid/partially_paid，旧trigger早退；未安装SD桥，不授Project DML。owner有效事实种子缺assignment仍是后续fixture必补前提；非空文件动态/其他canonical分支仍未审完整，不给广权限兜底。

系统xmin采用[官方PG16 aclchk源码](https://raw.githubusercontent.com/postgres/postgres/REL_16_STABLE/src/backend/catalog/aclchk.c)expand_col_privileges的负attnum处理作只读依据，额外列SELECT与系统列matrix，不授整表。该证据不是对锁定Docker镜像实际ACL的证明。

首个公开正控`first-red.tap`为缺安装stage模块/入口实现时失败，随后`first-green-attempt.tap`通过。之后补反例并按静态闭包核对迭代清单，初轮18个新用例：基础顺序/连续context正控，三个fresh scope前提缺失，五种身份漂移，两类matrix/guard证明缺失，postledger缺项，含完整CREATE ROLE SQL及两密码的合成错误/提交丢回执，取消伴提交ack，resource+receipt同时换ID，角色OID碰撞，源码未封存，交给adapter的paired lock/guard协议。后者仅SQL协议，不证明真实PG拒绝。敏感error不写到TAP或回执，保安全错误code/UNKNOWN/一次调用/资源finally，JSON不含runtime/observer密码或SQL原文。

SQL先只读preflight，单事务内身份/ownerOID/202 ledger及fresh role/scope复核，角色/权限/技术函数与guard安装，前后catalog validator再次核对；COMMIT后nonce才成功。任何发起后错误为UNKNOWN_DO_NOT_RETRY，不能把丢回执当rollback。没有凭据文件/目录外扫描；SQL只在内存经owner stdin合同，原B4擦除unknown状态不重置。

B5新测试没有实际命令/SQL/连接/资源；只读现有源码/工具，写自有合成临时CA/JSON。原108回归中原已确认CLI/metadata Node只读边界保留，与B5真实probe/DB无关。类型/lint用本树ignored service依赖链接只读既有中央依赖，无install/共享改动，不当隔离runtime闭包证明。实际Prisma生成SQL/PG解析/有效ACL/版本lock+UPDATE拒绝/COMMIT/丢响应/并发/TLS/物理清理未验。


## 既有ownership正控修正与最终冻结

静态另发现不能将202全部public对象owner一概等于主owner：POL275迁移3102–3108将七表，3110–3126将十七函数转jg_pol275_owner。新manifest列明确对象/签名映射并封存该迁移源；preflight/事务/后验矩阵按固定映射核，不扩大新角色权限、不任意允许别的owner。public schema另核owner/pg_database_owner。函数17签名和关系implicit ownership只读清单`/private/tmp/jg-382-task16-B5-existing-ownership-source-20261108.json`；本片关系筛选不含index/TOAST/rowtype。源脚本dynamic appendOperatingImpactThroughService恢复原owner按本次迁移actor创建链推断主owner，不冒DB已查。

新增第19个公开SQL适配器协议用例先RED（preflight没有封存legacy owner映射），GREEN后preflight有七表例外且不向runtime授legacy role；`legacy-owner-protocol-red.tap`/`legacy-owner-protocol-green.tap`保留。该红绿只验证发给mock adapter的SQL合同，不能证明PG实际owner矩阵通过；之前126绿不涵盖此修正，不沿用为最终证据。

最终Node20.20.2原108＋B5新19＝127/127，0fail/skip/cancel，31.23秒；原CLI25/25，18.00秒；六受影响CJS syntax/定向lint、API typecheck/全src lint及diff check通过。TS业务未改，后继仅CJS/SQL/manifest；类型/src lint日志保留，SQL grammar/catalog/role SQL没有实际执行或解析器实证。新manifest shape记录27 runtime/8 baseline observer/七关系与十七函数owner例外，仅产物静态核验，不是有效ACL测试。

外部证据`/private/tmp/jg-382-task16-baseline-acl-evidence-20261108`：first-red.tap/first-green-attempt.tap、legacy-owner协议红绿、final127.tap、cli25-freeze.tap、syntax6.log、cjs-lint-owner-freeze.log、typecheck.log、api-lint.log、manifest-shape.json；当前fingerprints见freeze-manifest.json。独立source探索不冒本片两轴0；冻结后仍待主控正式Spec/Standards和独立整合。无commit/push/真实SQL或资源。

| 当前源码 | SHA256 |
| --- | --- |
| run-task16-registered-pg-local.cjs | 92cc3a389f6cc08b5d701fd1c6c6bd41b2d79bbe787b4ab8f0e40eab2aaf08bd |
| run-task16-registered-pg-local.test.cjs | 2791ba76fe0a177aa9063fd453337c735ba0c7c3e6d0745d9d16f9cde26a4ad5 |
| task16-runtime-inputs.cjs | a2b38d4f629afcf02e6ef3c1d0bc9f3c41457f096bf11571671e7642b4f1c75d |
| task16-runtime-inputs.test.cjs | 6934cfc58954a37ebcc3c57ae442647d27866c70336bb8b596ab3df0a6c37b09 |
| task16-baseline-access.cjs | 6a50cf2dea60d9978fc0ed2a1debc60068e153fadb1b99ae7138390745994049 |
| task16-baseline-access.test.cjs | a5e2dafcd6d54adc688cc6db5a8aef92b43fe5bc408f7e42f25fa1b67bccf91a |
| task16-baseline-access.json | 936b903ec2985d41f06b0df3ec47280fd1639a29d32e9bab05ffd4e06dc98949 |
| task16-baseline-access.sql | 990f4301a700d4a7c734b1625bf85782e012bad916b396a1267a3c767be69bbf |
