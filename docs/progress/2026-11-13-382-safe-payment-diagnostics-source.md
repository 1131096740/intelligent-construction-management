# #382 / #398：最小安全诊断源码修复

准确源码 `2b1b1d402e7217c161416ab0e409e6ef160f25b8`，树 `3732bb00e79774996729837bcb258f8ede734ede`，相对 `9db5db76361dfca159a2d6dea207184faf5d632c` 共12路径、269新增/44删除，两提交60449741和2b1b1d40。用户已明确授权源码诊断、修复及验证；本段不产生新的手动迁移、实付、native、Java/LO或COS许可。

## 修改与边界

仅在已有factory/live-session/payment-case/fixture/receipt公开链保存固定guardPhase、原67项已知own-data错误码及已有白名单HTTP状态。原错误码字面及顺序逐字保持，新增纯模块的Set/WeakMap私有；getter/proxy和未知值不读取、不出回执，message/stack/SQL/URL/token/body不进入诊断。首份safe诊断和首份case失败锁存，不被后续清理错误覆盖。原守卫条件、执行顺序、请求次数、权限、预算、Schema/SQL及旧运行时锁保持。

本次HTTP已取得响应、随后BODY或AFTER_CHECK失败时，允许状态能在原控制流停止前留下；不把诊断当业务继续或运行准入。604初版独立审查发现第二次相同opening接口在transport前失败可能误用上一次201；公开seam有效RED复现后，2b1b将已完成RESPONSE_RETURNED观察排除。无法关联时省略旧状态/phase，fixture明确提供的本次状态仍保留；不承诺所有post-return且fixture未获返回值的错误都有状态。

## 验证和独立复审

准确2b1b的pnpm API build/typecheck/lint均exit0；完整本地编排1813通过、0失败、1既有skip（1814总）。编排含普通本地loopback、stdio、TLS/OpenSSL自动测试；不是零资源，也不是手动PG/SDKnative业务/JavaLO/VM/COS验收。公共case回归63/63，包含前次状态不串用、fixture明确状态、BODY500及AFTER_CHECK503模型；这些500/503是测试响应，不能填作真实88a状态。

604原版已有fixture93/93和四件CJS300/300；后继仅两件CJS修改，93结果保留原提交归属，不改写为新的实际数据库证据。有效RED/GREEN、初始测试写法修正和PATH缺pnpm导致的环境失败均保留外部，不把环境失败记作产品复现。

Standards：`/private/tmp/jg-398-standards-2b1b1d40-20261113/REVIEW.md`、`PROVENANCE.json`，硬规范0/判断smell0/额外正确性0，原604的P2关闭；另有独立5种纯源码模型，不并入作者1813。Spec：`/private/tmp/jg-398-spec-review-2b1b1d40-20261113.md`，0可操作发现；仅读源/核作者日志，未独立重跑作者宽门。

私有依赖后验56298常规文件、2473链接，无共享donor inode/逃逸链接。复制SDK曾有两项foreign路径元数据，作者保留原摘要后，以固定own Prisma CLI在OS拒绝网络、私有HOME/TMP/cache生成自身SDK；无手改vendor JS、无DB或query engine client构造。生成与后验不是实际native资格。详见 `/private/tmp/jg-398-safe-diagnostics-evidence-20261113/` 的SDK命令/后验、原白名单证明、公共RED/GREEN、successor包门与编排日志。

## 实际验收状态

作者最终准确回执 `/private/tmp/jg-398-safe-diagnostics-evidence-20261113/RECEIPT.md`，同目录`CANDIDATE.json`逐件绑定12路径、261迁移及冻结输入，`final.diff`和`successor-p2.diff`保留完整与修复差量。作者未自行push或将模型结果记作实际资格。

独立merger已从9db仅FF到准确2b1b，12件源码物理摘要、index和commit blob一致；351项既有SQL/Schema/JSON/锁与root四份文档/原暂存状态保持。回执 `/private/tmp/jg-398-merger-2b1b1d40-20261113/RECEIPT.json`。本段准备随SOURCE文档提交，不把未运行的新提交CI写成通过。

真实88a/3e747单次仍STOPPED、许可已消费，实际cause/HTTP状态/登录与付款结果仍UNKNOWN；不重跑、不修复后继续原许可。此补丁只修诊断证据丢失及新增串用状态，不能声称已修真实88a业务首因。下一步在最终提交准确CI成功后准备、独立审阅新SOURCE_ONLY方案；任何新的手动实际验收仍须对应明确授权。

#394本地SOURCE合成仍保registry PENDING、600cap及所有未验缺口；#394/#398仍OPEN。fresh GitHub45任务中14已关闭，前沿仅394/398，原始只读快照 `/private/tmp/jg-382-frontier-fresh-20261113.json`。无main合并、部署或生产变更。
