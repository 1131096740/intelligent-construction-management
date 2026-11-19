# 任务16 B2：运行时输入与执行归属准入源码

本轮用户对A+B明确授权“确认全部，仅源码与模拟测试”。B2独占新树 `/private/tmp/jg-382-task16-runtime-admission-20261107`，分支 `codex/enterprise-task16-runtime-admission-20261107`，准确中央基线 `ea663079eb9408fd6de882ab8dad05fd75017f7d`；未修改B1/A作者树或中央，未commit/push。

## 当前交付

B1的runtime准入占位已替换为真实实现：外部输入/源码包SHA，当前Node和6工具字节、当前执行根与adapter候选成员、worktree双向指针和fresh-build外部见证、5树文件/链接闭包、两dist归属、独立新鲜Node版本metadata、前后两轮真实manifest比较和两次唯一source核验、输入/工具后验。详见[准入合同与限制](../../services/api/prisma/prepared/task16/RUNTIME-ADMISSION-SOURCE.md)。

公开run的DI仅允许缺verifySource时回填真实只读verifier；不会补齐任何资源/SQL/App原生stage。只要注入就仍强制SIMULATED/nativeExecution=false；CLI没有模拟或跳过旗标。默认native由9项缺口变8个未完stage，仍在资源前拒绝，不能称完整真实driver。

## 公开模拟与当前检查

- 首条公开run省略verifySource原先在capabilities停止，实际RED→实现真实只读准入入口后按缺input文件失败GREEN。
- 根内未封存链接、package.main绕过链接指向未封存文件均公开RED（原先误完成）→加源/captured目标闭包GREEN；正常workspace包链接仍过。
- 合成metadata加载时改变已捕获marker亦公开RED（原先误完成）→增加metadata前后两轮比较GREEN。版本metadata改为固定新鲜Node子进程，不沿用require缓存，不构造PrismaClient。
- 上述早期RED/窄GREEN在本会话工具输出保留，没有另存原始TAP或预采集每个中途源码hash；不冒称已生成其独立冻结收据。下述完整最终TAP及当前源码hash均实际持久保存。
- 最终Node20.20.2新17＋原21生命周期共38项一次38/38、0fail/0skip，7.26秒。原21仅把“runtime未完”期待改为已实现，仍断言8stage不全、零资源/工件、无mock旗标和取消/清理原行为。
- 原source CLI25项一次25/25、0fail/0skip，19.07秒。未修改其实现或AST/源码包约束。
- 四CJS语法、CJS模式定向lint、API类型及全src lint均退出0；差异检查通过。既有central依赖仅本树ignored读取链接，无安装或共享修改，无根依赖链接。

证据目录 `/private/tmp/jg-382-task16-runtime-admission-evidence-20261107`：`final38.tap`、`original-cli25.tap`、`cjs-lint.log`、`typecheck.log`、`api-lint.log`。

| 当前未提交源码 | SHA256 |
| --- | --- |
| driver | a6c868de307ed457db2c978cc9522029d7e492f41a44c701f2d9ed9ebdf69db1 |
| 原21测试 | 840205f6d76a0057fed662d7db7b7fbbc57a31dd9c67e162b8adea6fc32bd728 |
| runtime准入模块 | 00a453b0921290ecb810efd7d840464bbd1db0462e3ccc8189255b33dc01ae66 |
| 新17测试 | 34123532f042b8651c1c572a4d91ffa0ba1052e7137336eefc74c9239c3bf348 |

这些是本地候选字节，不是ea已包含B2或最终SHA验收。独立两轴与整合待主控。

## 没有证明或执行

新17用例经公开run与进程边界：合成候选、worktree/构建见证与Prisma元数据；source CLI过程回执模拟，Python对合成5树捕获/比较和Node元数据进程实际执行。原25独立真实Git测试证明的是原source CLI，不把它们拼成当前真实执行树的全量准备/封存已过。实际部署依赖、完整OS/dynamic-loader/内存来源、资源角色/TLS/ACL、SQL语法与安装、正常COMMIT/故障/丢响应/并发及清理均未验。

没有SQL/PG/Docker/端口/证书或业务资源创建，没有真实业务/银行/短信/COS/部署或生产写。授权引用/源码包/准入通过均不授实际资源权限；#398 OPEN、17/24阻塞、16/42/44硬门及13/45状态不变。

## Standards两项P2修复（2026-11-08，当前未提交后继）

原完整双轴为Spec0、Standards2P2；原报告 `/private/tmp/jg-382-task16-runtime-admission-spec-review-20261107.md`、`/private/tmp/jg-382-task16-runtime-admission-standards-review-20261107.md` 保留。原四源码freeze为本收据上表a6c868de/840205f6/00a453b0/34123532，不据原38通过宣称这两例已覆盖。

1. **manifest读取次序**：新公开run反例使用本轮自有0600 FIFO，无device输入。旧00a453b0在type/size检查前无界hash读取而挂起；监督父spawnSync设置1500ms硬截止和SIGKILL。首红`manifest-fifo-first-red.tap`及补充诊断红`manifest-fifo-diagnostic-red.tap`保留，诊断实际为status:null/signal:SIGKILL/errorCode:ETIMEDOUT；父返回后t.after只清本例自建目录/FIFO。最小修复先经原private/regular/size reader取得一份bounded bytes，再同bytes核外部digest与JSON；比较后的manifest摘要也改用有界reader。原FIFO用例立即受控拒绝GREEN，`manifest-fifo-first-green.tap`。
2. **父loader入口缓存**：同一harness父module先运行一次main=index.js正确版本，随后保留旧index、改main=bad.js，重新封存API依赖manifest与完整inputs后，在同父再运行。第1修复后的模块`6470fe5d8a08faadb0d34fc109515786525785e7dc6a83051607a3a414305a86`仍误完成，首红`metadata-main-cache-first-red.tap`。现将resolve本身也移到新鲜Node进程，父核canonical/封存覆盖后另新鲜Node加载元数据；没有只删require.cache。窄GREEN`metadata-main-cache-first-green.tap`。原审查的[Node20.20.2官方loader源码](https://raw.githubusercontent.com/nodejs/node/v20.20.2/lib/internal/modules/cjs/loader.js)指针保留；本轮只读核到独立Module._cache/_pathCache及_findPath先读path cache、包入口解析后写入缓存，与公开反例一致。

当前新源码SHA256：runtime模块 `7fbafb65c4d66911fd1c3c9abaa57e1765cd60196016ddb82b708446bc44a71b`；新测试 `ad815c2765efd3393e6ae05245a9f1317e7a2ae40d59798b5d7f16d939a2bc18`。driver a6c868de、原21测试840205f6未变。

完整后继原21＋新19共40/40、0fail/0skip（9.42秒）；原CLI25/25（19.07秒）；四CJS语法/CJS lint、API类型与全src lint均退出0，差异检查通过。持久日志为同目录`review-fixes-full40.tap`、`review-fixes-original-cli25.tap`及三份`review-fixes-*.log`。原38、旧25及所有红绿收据不覆盖。原轴增量复审仍待主控，不提前称两P2已独立关闭。

本轮仍仅源码与模拟/自有文件协议：无真实SQL/PG/Docker/端口/证书或业务资源，8个native阶段闭门、#398/17/24/16/42/44及13/45均保持。未commit/push。

## 同一有界读取P2的后验残留统一补修（2026-11-08，当前后继）

原Standards增量已关闭cache项，但指出7fbafb65的inputs/packet/witness及工具后验仍有raw hash读取，故bounded-read仍1项未关闭。本轮没有把上一段40/25或第一处manifest修复冒充整项独立通过；原报告和两轮证据全部保留。

新增公开run+metadata反例只操作自有合成inputs：metadata返回前unlink并以0600 FIFO替换该文件，依赖5树未变、source协议仍有效。7fbafb65在最终raw hash处再次挂起；父3000ms硬超时、SIGKILL后才返回，`post-input-fifo-first-red.tap`实际记录status:null/signal:SIGKILL/errorCode:ETIMEDOUT。没有device输入、FIFO写入方或真实服务；监督child退出后t.after只清自建目录。新统一reader后，`post-input-fifo-first-green.tap`按正规文件资格立即拒绝。

本次审完整个helper，去掉全部readFileSync/hashFile：

- 私有inputs、packet、manifest、比较收据、preparation初读/后验均经同一qualified FD；manifest摘要/JSON使用同份bounded bytes，prep初读也同bytes解析/摘要。普通私有上限16MiB，manifest64MiB。
- source/adapters与workspace tracked目标流式摘要上限64MiB；gitfile及反向指针只取有界16KiB，同字节计算gitfile摘要。
- 工具初读及后验都验证正规/无符号别名/owner/禁止组他写/可执行资格，512MiB固定上限、64KiB块流式摘要，无需一次加载整个大binary；后验额外绑定初次dev/ino/size/mode/uid/gid/mtime/ctime。
- 所有文件在O_RDONLY|O_NOFOLLOW|O_NONBLOCK打开后fstat核正规文件与资格，再按见证size固定位置最多size+1读取，防止stat→open被换成FIFO而阻塞。读前后fd身份/stat及命名inode稳定校验，finally关闭本次fd。没有修改实际node/git/python或共享工具。

原40全保，另加后验inputs、preparation witness、fake docker三例自有FIFO，合计43/43一次通过，0fail/0skip（10.77秒）。原CLI25/25（18.79秒）；四CJS语法/CJS lint、API类型及全src lint退出0，差异检查通过。相关日志为`qualified-reader-first-full43.tap`、`qualified-reader-original-cli25.tap`及三个`qualified-reader-*.log`。无残留运行会话。

当前freeze：helper `8fe990b457b7273101624fe7c72b161f10889d35ad5c0022cda483f7b5a5ce3d`；新测试 `0c57ddce3585688864f06b2f7fc617c54e2987cdbf7c6e455e5cf86f4ed3e418`。driver a6c868de、原21测试840205f6不变。原轴再核仍待主控；未commit/push，不越过8原生闭门、#398/17/24/16/42/44或13/45边界。
