# Task12 FaceA 签章归档 Web consumer — 本地 HOLD

基线 `84cb33ea755c2bf16a619d5d6670c66511d7873b`。隔离树 `/private/tmp/jg-task12-archive-web-consumer-20261109`，不提交、不推送、不合并、不部署、不关闭 #394。

消费后端 immutable `consumer-contract-A1-freeze`，full10 sourceSet `6cad4b7ac049285079729d66bb961850af14c14f85a77d3edb64fbe20407ead0`；共享 DTO SHA256 `763496f5af3db8c7a6b3949074ef8da48400c78483c42d7fa9e563b768dfd79b`。仅批准复制该 DTO 及生成其一个 DTS，运行 JS 全部保原；Web 依赖来自已登记的完整 COPY，没有 install、硬链接、共享可写或 SDK 运行。

详情依据真实 actor/V/R/T/docR/F、source/scope、eligible/enabled/webWriteReleased；当前正式后端 capability 仍 false。测试 cap=true 仅模拟未来后端发布，不提供本地开关。主管确认我方线下盖章，成功必须 fresh 原V/原T completedAt/By；响应不明先只读核对，他人完成单独提示。原合同员选择有序1至20份PDF，已有私有上传接口逐件上传，失败保留成功件；人工核对后冻结 UUID4 key、完整payload及固定字段顺序UTF8 SHA。原key回执 intent/SHA/V/result/文件顺序全部匹配才成功；HTTP201不能单独认定。

UNKNOWN锁定文件、顺序和相冲突生命周期操作。自动恢复只GET；用户明确继续也先GET unknown，再fresh核同tuple/actor/cap，仅相同body/key发一次，不新增上传。403/5xx/404/错回执保全部原件及意图，严格版本化localStorage不含密码/ticket。actor/V切换、离开页面与A→B→A复用页面均用单调scopeEpoch隔离；每次操作捕获epoch，await后及catch/finally回写核epoch/actor/V/disposed，旧finally不清新scope busy。真实公开刷新A→B→A＋首文件延迟曾实际RED：旧source继续第二文件及归档POST；最小epoch修复后两端GREEN，旧源e7bb62/24/221全保、不挪给新增量。V2凭证展示真实Evidence key，下载始终实际fileId；详情和资料库复用原密码/原因/capability/ticket路径。原 CON10 draft/submit 源码保原，V1旧行为保留。

公开 browser mockHTTP 的实际 RED→GREEN：盖章入口缺失、PDF归档入口缺失、UNKNOWN手动继续响应式DTO复制失败、fresh预检缺失、旧入口残留、403提示、盖章人工继续、已证明成功后详情刷新失败。分件重试、1/20/21、重复、取消、错SHA/intent/key/order/V、权限与R/T/F漂移、账号/V隔离、损坏本机意图、绑定繁忙、双击、晚回包均通过公开页面边界检查。桌面1366×900与手机 Chromium 390×844touch；不等于Safari或实体机。先前50项浏览器与24项 CON10、221项API/draft Vitest是历史执行，最终同源门另见下面外部冻结包；不混合候选。

完整证据目录 `/private/tmp/jg-task12-archive-web-consumer-evidence-20261109`：原 RED、启动/MachPort/缺依赖/测试定位与PDF新窗口夹具失败均保留；资料库新窗口采用 BrowserContext 精确 localhost API 拦截，文件attachment直接核模拟原件字节；历史资料库新窗口GET曾漏出page.route，Vite尝试连接默认localhost:3000而ECONNREFUSED；没有建立连接或真实写入，此为模拟边界漏出尝试，不是业务RED，也不能称零真实网络尝试。随后先停止确切自有回归PID及遗留Vite子进程，新增首Page前全origin context guard、未知API受控失败、serviceWorkers:block；owned Vite wrapper在listen前断言proxy为空、前置未知API598，刻意缺mock探测598，生产vite配置未改。原CON10用新owned配置复用原测试与此wrapper，最终必须核零非故意598日志。文案改动一度误用detail变量导致页面异常，已修正contractDetail，原失败也保留。最终源manifest、base preimages、执行命令/退出码、前后指纹、截图、依赖守恒与后端合同对齐见外部 `final-freeze/` 和 `HANDOFF.md`。

这份实现不包含 FaceB/direct/outside/upward/inline、完整5×3、真实后端浏览器联合运行、数据库/生产/CI证据；不能据此开放runtime cap或宣Task12全生命周期完成。

## A3 两轴集中修复（待独立复审）

A2实际66/24/221成绩保留原sourceSet，但审批进度mock错误[]触发原Panel技术红条；archives.summary误数组静默0、V1审批单capability缺available。新增公共页面断言在A2真实RED（A3-visible-red2三场景），再按已有公开API返回类型修3个响应（无产品兼容错误mock），初始正常页必须显示准确审批空态且无错误alert。资料库实显两归档件summary与后端固定9a4语义一致，V1 available真/假分别校按钮。首Page前context记录全部pageerror/console.error；只允许当前用例显式模拟响应已登记的同URL/status浏览器资源错误，绝不吞未知或应用异常。

另一产品P2为资料库公共旧主管确认文案，改“各类归档资料按相应业务流程办理”，只改通用说明及其既有语言单测期望，V1主管确认权限/协议/动作不变。新图在正确空态后截图，额外记录资料库实际摘要与V1可用按钮。A2/2199证据索引、报告、错误截图均不覆盖；A3完整源/两新增config路径前像、最终同源门与依赖守恒另封，待双轴复审，不自动整合或开放cap。
