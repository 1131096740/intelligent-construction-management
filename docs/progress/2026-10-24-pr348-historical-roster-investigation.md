# PR #348 手机花名册历史故障取证

## 当前结论

历史根因尚未查明，PR #348 继续保持 draft。本文与本轮采证补强均不构成手机业务故障修复，不解除历史根因阻断；本轮不合并、不部署、不访问生产或改动历史业务数据。

主线基线为 `3d6736fbf047b4e39c8453c812b4980c8ce4a40f`。本轮从独立 bare 仓库建立干净 worktree，未吸收或改动共享根目录。历史源码从准确 Git 对象重新导出，未复用旧候选工作目录；所有数据库均为新建的隔离合成 PG16，执行后清理。

## 历史记录能够证明什么

| 准确提交 | 原故障证据 | 能够确认的触发器 |
| --- | --- | --- |
| `d6719ba2ad89f716f5d67dc0795cdccf98d9820f` | [原 CI attempt 1](https://github.com/1131096740/intelligent-construction-management/actions/runs/39308767811/attempts/1)，job `118252606473` | 手机确认调入的 click 已返回，源码第24行等待抽屉数量归零时，全局30000毫秒届满；抽屉数量仍为1 |
| `6ec31b9fabe9cfc4a91215c1476b773bb7d32224` | [原 CI](https://github.com/1131096740/intelligent-construction-management/actions/runs/39288927919)，job `118184164088` | 手机确认调出的 click 已返回，源码第32行等待抽屉数量归零时，全局30000毫秒届满；抽屉数量仍为1 |

两份错误里的5000毫秒是 expect 配置，不是实际触发的独立接口超时。原日志没有每个动作耗时、请求阶段或响应完成事件，GitHub 未上传原失败 trace。因此不能由 click 返回推断 Vue 处理函数已经执行，也不能由缺少 apply 记录断言没有点击；提交前还会重新读取 options。

已按本轮冻结的Playwright1.64源码核对：`toHaveCount`的one-shot、重试调度与日志压缩不同于`expect.poll`；日志重复计数不能直接当作固定轮询次数，也不能据此反推确认后的剩余预算。全局30秒结束测试等待后还会进入teardown，API日志可能随后才收束。当前只能确认全局期限触发，不能由3/5次计数观察断言此前耗时分布、后台卡住或预算不足就是历史根因。

原始失败日志已分别封存，SHA256 为 `5612f2370d2e2dd63b5e82c026dcf8893648927e48f9ab53f2ce1932ac95c376`、`6103177edbdb42f599c3fc3b0bd48e0e1f6a0f6b0d8a7a48a0ba94c6b4c38b8a`。后续重跑未覆盖私有原件。

## 本轮验证及边界

| 验证对象 | 结果 | 证明边界 |
| --- | --- | --- |
| 准确主线原 employee_onboarding 门 | 六套59/59及三组桌面/手机真实页面场景通过 | 当前基线可运行；不能证明历史故障根因 |
| 原生 GitHub 准确 `6ec31b9f` | [CI 40069461199](https://github.com/1131096740/intelligent-construction-management/actions/runs/40069461199) 的员工分片22/22通过 | 整个历史 workflow 的 Quality gates 因旧依赖审计失败，Release gates 随之失败；不能称完整 CI 通过 |
| 原生 GitHub 准确 `d6719ba2` | [原 CI attempt 2](https://github.com/1131096740/intelligent-construction-management/actions/runs/39308767811/attempts/2) 的员工分片22/22通过 | attempt 1 的故障仍成立；新绿灯只证明未复现 |
| 原生 GitHub 保留GLib`.9`的准确`6ec31b9f` | 控制提交`cf21fdec`的[历史重放40077151994](https://github.com/1131096740/intelligent-construction-management/actions/runs/40077151994)：入职12/12、花名册10/10、零跳过，源码干净且清理成功 | GLib初终均`.9`，NSS仍由`.2`更新至`.3`；未复现、不称完整历史host等价 |
| 全历史 `6ec31b9f` Linux 重放 | 原2692个源码文件、旧生成 Client、178个迁移及原22项通过 | 使用本轮隔离运行环境，不能称完整历史 runner 快照等价 |
| GLib 单包对照 | `.9` 与 `.10` 各自原22项及额外观测22项均通过 | 未建立 GLib 与历史故障的因果关系 |

GLib 对照从同一个镜像派生，531个已装包仅 `libglib2.0-0t64:amd64` 在 `2.80.0-6ubuntu3.9` 与 `.10` 间切换；NSS保持`.3`，前后673份源码、Client、浏览器和字体冻结文件一致。已静态核实 WebKit 2370 实际解析系统 GLib/GIO。额外观测轮仅为 roster 增加 reporter 与 trace 保留，不能替代无观测的原22项资格；原30秒、父项120秒、外层180秒及零重试保持。

观测轮手机的关闭断言：旧库调入827毫秒、调出822毫秒；新库调入847毫秒、调出831毫秒。两端各有11条固定接口元数据、两次apply201，关闭与最终成员为零的原断言通过。状态码、HAR耗时及正文文件引用均不单独代表页面处理完成。步骤 wallclock 耗时与测试计时槽总耗时分开记录，不混算截止时间余量。

公开环境对照还确认 runner/image、GLib、NSS及PG镜像索引有漂移；四次原生运行的实际 PG 版本均为16.15。相同多架构索引不代表本地arm64与GitHub amd64完全等价。GLib官方[变更记录](https://changelogs.ubuntu.com/changelogs/pool/main/g/glib2.0/glib2.0_2.80.0-6ubuntu3.10/changelog)和[补丁](https://git.launchpad.net/ubuntu/+source/glib2.0/plain/debian/patches/lp2165869-fix-gtask-run-in-thread.patch?h=applied/2.80.0-6ubuntu3.10)中的线程池锁死说明是一条已做对照的线索，不能冒称历史根因。

GLib`.9`原生重放仅下载两个固定脱敏JSON工件，失败trace数为零，符合原`retain-on-failure`语义；没有下载原始trace。工件digest已匹配，私有证据manifest的SHA256为`0a4c214c7b8f60d0a61caf6e1948bb3d83bdcfb3937631e239462f21d1838242`。

私有资格及对照收据分别为 `/private/tmp/jg-pr348-glib-contrast-20261024/final-qualified-runtime-receipt.json`、`paired-replay-result.json`，SHA256为 `b082b0626b01d593448f247e31d44852b80df1b3047fc00630d7a5a2341eb860`、`06e9b5600503a6bc7ba74da03be9fec67c56c3ee82243fdcdc4b10db637dff7a`。含认证的原始 trace、日志和合成账号信息仅留在0700/0600私有目录。

## 采证补强的范围与验收接口

当前主线已将入职、花名册和人员反馈输出目录隔离，但CI仅输出扁平动作时序，没有网络阶段、浏览器归属或持久安全摘要。下一次失败仍可能丢失判因所需信息。

本地补强只通过现有CI的失败分支读取固定花名册输出目录，按桌面、手机与未知归属输出动作和三个固定接口的白名单元数据。CLI的标准输出及原子写入的JSON是本轮回归接口；测试使用含认证哨兵的原生格式ZIP，检查未完成201不能标成完成、浏览器不混合、伪造resources不参与解析、非法或缺失trace有明确不可用状态、正文与认证不泄漏。

CI只持久保存脱敏JSON，禁止上传原始ZIP、正文、认证头或任意错误文本。采证补强不改变业务调用、权限、数据模型、迁移、原预算或重试。

新增原生重放只由专用分支 `codex/pr348-historical-evidence-20261024` 的 push 触发：控制代码与准确历史 `6ec31b9f` 分开检出，运行一次原22项；不需要合并或修改默认分支。旧 runner 仅在私有内存副本中固定原PG索引，并添加同步 suite-end reporter，逆向还原必须与原文完全一致，保留原文件路径、数据库创建及 finally 清理。旧 Schema、生成 Client 与浏览器执行文件均校验冻结摘要，原应用和 E2E 源码不改。

重放前缀只尝试保留 runner 已安装的 GLib `.9`，初始状态不匹配即报环境准备失败，不先降级再冒称历史环境。签名快照与当前官方HTTPS源仅组成任务私有APT配置；NSS等其余环境仍可能漂移。因此该任务只是一组受限对照，不代表完整历史host恢复，也不提供单独的根因证据。它不会连接生产或复用历史数据库。

目前已完成共享采证器的6项新增回归及受影响编排文件14/14，并以本轮4份真实原生trace验证两端分组和固定网络投影。新增原生重放有10项纯回归，包含前缀Python夹具；接线后的原完整CI编排339/339、零跳过、退出0。首次编排337/339暴露旧workflow/推送分支精确清单尚未同步，修正两处固定清单后重跑整门通过，保留首次失败，不当历史业务RED。成功私有日志SHA256为`85ccdb37947c92b66b95277ab84c633838d08b833dbb796ccddef87e08b1de88`。

双轴首审各发现同一项P2：私有空APT配置会默认保存未压缩索引，正常官方索引即可超过事后100MB存储限制，导致原22项启动前失败。已明确`Acquire::GzipIndexes "true"`，将实际配置生成提取为纯函数；新增第19项前缀夹具先RED再GREEN，保持原限制和签名校验。这是重放环境准备修正，不是花名册历史根因。原生运行前仍须以新提交复审与完整CI为准。[APT官方说明](https://manpages.ubuntu.com/manpages/noble/en/man5/apt.conf.5.html)

独立双轴审查与准确新SHA完整CI尚待完成，不预填通过；本次检查通过不代表历史根因已验证。

## 首轮远端门禁新增阻断

诊断控制提交`cf21fdec2008eeac6d0461c9dfc9af0b5c39de1f`的[完整CI40077151960](https://github.com/1131096740/intelligent-construction-management/actions/runs/40077151960)在原生产依赖审计门失败：既有body-parser1.20.6与multer2.3.0命中2026-10-22/23公布的两条高危公告。官方修复版本分别为[body-parser1.20.9](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[multer2.5.0](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)。原审计阈值保持high；只在本轮当前依赖的既有覆盖项修补，历史6ec源码、锁与生成Client不随之改变。

该CI终态24项成功、Quality审计与Release汇总两项失败，完整收据SHA256为`50b352469897c35af07cb38b39323c215939e8fb506fbbb0f33dec7ba81b7605`。原Quality job120822866008日志私有封存SHA256为`d2cd678153cd3a03cff6647536977dd88cd3f146c9a1fc206271cb7ea987e7b3`，不重跑覆盖首次失败。

当前依赖仅更新两处既有override、必要生成锁变更和Multer严格版本期望；Nest10.4.22、Express4.22.1与原high阈值保持。真实HTTP/DTO/18类multipart入口及Multer集成四套124/124通过，API类型与lint退出0，原`pnpm audit --prod --audit-level high`退出0，高危/严重均零，仍有1项既有Nest中危。当前Schema的Prisma Client在本worktree重新生成，未复制旧Client或写用户缓存。私有兼容验证收据SHA256为`e5a678fdd1a154f4cea0beea7b4364e0dabb9ee00e5f90d78f006232210fd058`。

依赖更新后，原完整CI编排在同worktree的新冻结依赖上重新339/339、零跳过、退出0，日志SHA256为`f71479116fb17b23e870f76e696e38c17aa8bcb301e81f8990032b3943a50fdb`；未借用主线worktree的依赖验证新锁。

审计失败与花名册历史故障无已证因果关系；依赖补修后的双轴复审及准确新提交完整CI须另行验证，不能沿用cf21结果。

解除draft仍须取得与原症状匹配的失败现场，定位真实前后端因果链，并通过针对性反证、修复回归和准确新SHA完整CI。当前不满足该条件。

## 确认点击至抽屉关闭的补充调查

所有者确认目前只有两次历史CI失败，没有仍可复现的实际手机环境。原失败没有上传trace，缓冲日志也不能恢复单步骤时间。后续以原生CI采证为重点，不用本机成功样本推断历史停点。

本轮从准确主线`3d6736fb`创建独立干净worktree，旧`6ec31b9f`在另外的完整冻结Linux镜像、178项迁移和一次性合成库中执行。两轮原22项均通过，完整链包括：确认DOM事件、处理函数、重新读取资格、提交、后端密码与事务、浏览器正文解析、保存事件、父页面关闭状态、抽屉DOM销毁。四个前端Git blob的定点观察均可逆还原，原E2E动作、断言、预算及零重试保持。观察会消耗预算，诊断轮次不能替代无观察的原门资格。

首轮手机调入/调出在点击后约72/87毫秒完成提交正文解析，同一轮关闭状态立即设为false，约381/393毫秒抽屉DOM消失；后端密码校验约13–14毫秒、事务约9–21毫秒。后端finish不单独证明浏览器收到完整正文，配对仅依据固定路径、顺序与时钟窗口，没有注入关联请求头。两轮均未出现历史同症状失败。首轮安全收据SHA256为`92e017557ebaa77080e420accfb336fec27e21d21ef9c55e1b5377429ad95ad5`，第二轮链摘要为`3e163033acde227a19135b21e587b43826b2d0baa7bbc20a0d3ffec3f900facb`。

额外重复诊断中，两端各3次原场景实际4次通过、2次失败。两项手机失败均在确认点击之前的横向溢出断言（允许391，实际734），分别约6.5/6.1秒，不是历史30秒抽屉断言超时；未略过原断言，未把它们当历史根因。安全分类收据SHA256为`f3bfa1309a2a7ab5da80f1c5573497be3724b6cea4cada6555daffac66b22320`。重复轮次不作完整22项资格，其他9项Jest明确跳过。

承接控制提交`64475dee`的[完整CI40078505535](https://github.com/1131096740/intelligent-construction-management/actions/runs/40078505535)已终态26/26成功，[原生历史重放40078505540](https://github.com/1131096740/intelligent-construction-management/actions/runs/40078505540)原22项全过；仅说明该控制提交通过，不为新增补丁背书。新补丁只在私有临时目录接线原22项全链观察，新增上传也只允许严格白名单`chain.json`；原日志、认证、正文、页面及trace不上传。缺失、截断或观察器写入失败必须标未知。新增原生链观察尚未执行，业务根因、最小修复和解除draft的条件继续未满足。

## 完整链原生采样结果与 d671 调入补证

控制提交`e2d91fbd0b9f13b7614dab6ddc6bec71d4eeee38`的[完整CI40096884597](https://github.com/1131096740/intelligent-construction-management/actions/runs/40096884597)终态26/26任务全部成功。[原生重放40096884616](https://github.com/1131096740/intelligent-construction-management/actions/runs/40096884616)三次独立轮次均为同一控制提交、准确6ec旧源的原22项，每次22/22、零跳过；安全artifact摘要逐一与本地ZIP核对，完整链另经独立验收，无截断。三次手机确认点击至apply正文解析分别为调入100/148/146毫秒、调出118/153/167毫秒，关闭状态更新后约300毫秒抽屉DOM归零。完整CI与重放通过分开成立，均不证明历史根因。

所有者随后明确仅补一次准确`d6719ba2ad89f716f5d67dc0795cdccf98d9820f`的原生完整链采证。控制worktree重新从准确主线`3d6736fb`干净建立后承接已审查采证提交；准确d671旧源另外完整检出。只读核对其树为`54d33e861ce9d29d19ae1bf7c8c56bde3095e613`，2811文件、192迁移，原E2E、runner、四个前端观测源、七个后端观察文件与6ec逐字相同；花名册HTTP夹具仅新增显式legacy项目ID。原动作、断言和观察锚点无需修改。

d671旧锁摘要仍为`0d86a063b957d98d1f1f3e81f74a8bceb00be405737631a10a21c283042f3f2b`。原始Schema摘要`eb12dbf9800e2c014f3b78bb0348b0d9777f921b3087508d5083affb381d1282`与生成Client的Schema不同：在独立准确旧源、冻结安装和固定Prisma5.22实际生成后，后者为`a909c04b8c85f3cc5fc810ec93b33f19d90ab18788ba58e657d29ee002aa93c8`，不能沿用6ec的生成摘要。首次生成因Prisma尝试更新用户缓存而被沙箱拒绝，原件保留；改用任务私有的官方固定引擎并核验压缩包摘要后生成通过，未复制旧生成Client、未连接数据库。原生runner仍须独立生成并匹配同一摘要，否则在原22项启动前报准备失败。

历史实际runner镜像为Ubuntu24的`20261018.339.1`，当时workflow只使用浮动`ubuntu-latest`及Node20；本轮固定Ubuntu24.04及实际Node20.20.2不能证明完整host相同，NSS差异仍保留。历史手机调入失败位于确认click23返回后的drawer断言24，全局30秒届满；双浏览器合计45.8秒不能反推手机剩余预算。没有原请求阶段、trace或真实手机复现环境。

本轮仅适配两份明确旧源的身份与d671生成摘要，保持原22项、30秒/120秒/180秒、零重试及业务断言。新补丁复审、一次准确原生运行及新准确提交完整CI均以后续本轮收据为准，不预填通过。若采到相同失败，先封存、缩小及验证因果再最小修复；其他失败单列，不猜测业务修复，不解除draft、不合并或部署。
