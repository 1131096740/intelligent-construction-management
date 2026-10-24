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

原始失败日志已分别封存，SHA256 为 `5612f2370d2e2dd63b5e82c026dcf8893648927e48f9ab53f2ce1932ac95c376`、`6103177edbdb42f599c3fc3b0bd48e0e1f6a0f6b0d8a7a48a0ba94c6b4c38b8a`。后续重跑未覆盖私有原件。

## 本轮验证及边界

| 验证对象 | 结果 | 证明边界 |
| --- | --- | --- |
| 准确主线原 employee_onboarding 门 | 六套59/59及三组桌面/手机真实页面场景通过 | 当前基线可运行；不能证明历史故障根因 |
| 原生 GitHub 准确 `6ec31b9f` | [CI 40069461199](https://github.com/1131096740/intelligent-construction-management/actions/runs/40069461199) 的员工分片22/22通过 | 整个历史 workflow 的 Quality gates 因旧依赖审计失败，Release gates 随之失败；不能称完整 CI 通过 |
| 原生 GitHub 准确 `d6719ba2` | [原 CI attempt 2](https://github.com/1131096740/intelligent-construction-management/actions/runs/39308767811/attempts/2) 的员工分片22/22通过 | attempt 1 的故障仍成立；新绿灯只证明未复现 |
| 全历史 `6ec31b9f` Linux 重放 | 原2692个源码文件、旧生成 Client、178个迁移及原22项通过 | 使用本轮隔离运行环境，不能称完整历史 runner 快照等价 |
| GLib 单包对照 | `.9` 与 `.10` 各自原22项及额外观测22项均通过 | 未建立 GLib 与历史故障的因果关系 |

GLib 对照从同一个镜像派生，531个已装包仅 `libglib2.0-0t64:amd64` 在 `2.80.0-6ubuntu3.9` 与 `.10` 间切换；NSS保持`.3`，前后673份源码、Client、浏览器和字体冻结文件一致。已静态核实 WebKit 2370 实际解析系统 GLib/GIO。额外观测轮仅为 roster 增加 reporter 与 trace 保留，不能替代无观测的原22项资格；原30秒、父项120秒、外层180秒及零重试保持。

观测轮手机的关闭断言：旧库调入827毫秒、调出822毫秒；新库调入847毫秒、调出831毫秒。两端各有11条固定接口元数据、两次apply201，关闭与最终成员为零的原断言通过。状态码、HAR耗时及正文文件引用均不单独代表页面处理完成。步骤 wallclock 耗时与测试计时槽总耗时分开记录，不混算截止时间余量。

公开环境对照还确认 runner/image、GLib、NSS及PG镜像索引有漂移；四次原生运行的实际 PG 版本均为16.15。相同多架构索引不代表本地arm64与GitHub amd64完全等价。GLib官方[变更记录](https://changelogs.ubuntu.com/changelogs/pool/main/g/glib2.0/glib2.0_2.80.0-6ubuntu3.10/changelog)和[补丁](https://git.launchpad.net/ubuntu/+source/glib2.0/plain/debian/patches/lp2165869-fix-gtask-run-in-thread.patch?h=applied/2.80.0-6ubuntu3.10)中的线程池锁死说明是一条已做对照的线索，不能冒称历史根因。

私有资格及对照收据分别为 `/private/tmp/jg-pr348-glib-contrast-20261024/final-qualified-runtime-receipt.json`、`paired-replay-result.json`，SHA256为 `b082b0626b01d593448f247e31d44852b80df1b3047fc00630d7a5a2341eb860`、`06e9b5600503a6bc7ba74da03be9fec67c56c3ee82243fdcdc4b10db637dff7a`。含认证的原始 trace、日志和合成账号信息仅留在0700/0600私有目录。

## 采证补强的范围与验收接口

当前主线已将入职、花名册和人员反馈输出目录隔离，但CI仅输出扁平动作时序，没有网络阶段、浏览器归属或持久安全摘要。下一次失败仍可能丢失判因所需信息。

本地补强只通过现有CI的失败分支读取固定花名册输出目录，按桌面、手机与未知归属输出动作和三个固定接口的白名单元数据。CLI的标准输出及原子写入的JSON是本轮回归接口；测试使用含认证哨兵的原生格式ZIP，检查未完成201不能标成完成、浏览器不混合、伪造resources不参与解析、非法或缺失trace有明确不可用状态、正文与认证不泄漏。

CI只持久保存脱敏JSON，禁止上传原始ZIP、正文、认证头或任意错误文本。采证补强不改变业务调用、权限、数据模型、迁移、原预算或重试。

新增原生重放只由专用分支 `codex/pr348-historical-evidence-20261024` 的 push 触发：控制代码与准确历史 `6ec31b9f` 分开检出，运行一次原22项；不需要合并或修改默认分支。旧 runner 仅在私有内存副本中固定原PG索引，并添加同步 suite-end reporter，逆向还原必须与原文完全一致，保留原文件路径、数据库创建及 finally 清理。旧 Schema、生成 Client 与浏览器执行文件均校验冻结摘要，原应用和 E2E 源码不改。

重放前缀只尝试保留 runner 已安装的 GLib `.9`，初始状态不匹配即报环境准备失败，不先降级再冒称历史环境。签名快照与当前官方HTTPS源仅组成任务私有APT配置；NSS等其余环境仍可能漂移。因此该任务只是一组受限对照，不代表完整历史host恢复，也不提供单独的根因证据。它不会连接生产或复用历史数据库。

目前已完成共享采证器的6项新增回归及受影响编排文件14/14，并以本轮4份真实原生trace验证两端分组和固定网络投影。新增原生重放有10项纯回归，包含前缀18项Python夹具；接线后的原完整CI编排339/339、零跳过、退出0。首次编排337/339暴露旧workflow/推送分支精确清单尚未同步，修正两处固定清单后重跑整门通过，保留首次失败，不当历史业务RED。成功私有日志SHA256为`85ccdb37947c92b66b95277ab84c633838d08b833dbb796ccddef87e08b1de88`。

独立双轴审查与准确新SHA完整CI尚待完成，不预填通过；本次检查通过不代表历史根因已验证。

解除draft仍须取得与原症状匹配的失败现场，定位真实前后端因果链，并通过针对性反证、修复回归和准确新SHA完整CI。当前不满足该条件。
