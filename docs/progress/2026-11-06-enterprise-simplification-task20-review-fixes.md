# 任务20原两轴3项P2补修收据

原候选 `e3aab6b02a0fa255a9f399fb6d44325034d121f8` 的独立报告保持：`/private/tmp/jg-task20-standards-e3aab6b0.md`（1P2）、`/private/tmp/jg-task20-spec-e3aab6b0.md`（2P2）。原e3源码包、全部旧失败和通过记录不覆盖。补修检查点 `6648516c`，已合正式中央仅5MD tip `46f9351989d711f5eb64f7211b4f54234898a59e` 为 `e4bebb6b`；PROGRESS冲突保留正式9/45及11收口全文，同时保留e3三P2事实。未吸收其它WIP，尚待原两轴复审。

## 公开反例到修复

1. **UUID大小写契约**：110真实公开HTTP反例同时证明合法大写保存后未规范、大小写等价两行被创建。仅General新2 payload写前将UUID转小写，再按规范值去重；create与edit重读为同一规范行，重复在事务/编号/状态/审计写入前拒绝。原SQL/DTO/旧1语义不改。114/129包含uppercase创建编辑重读与重复无副作用断言，不将内存通过称为真实PG CHECK通过。
2. **待办截断与计数**：先将合成持久层改为真实执行当前查询所需orderBy/take/cursor/skip/id范围比较。110以实际firstPage100排除目标证明适配器忠实截断，再在公开 `/me/work-items` 复现100个较新无关申请挤掉本人旧待办，以及本人102职责仅计100。General专用helper沿现有businessProjectIds和仅General有效有界委托轮次预筛，每批最多100按id keyset遍历到末页，逐项调用原当前职责权威校验。最后保持原updatedAt降序，既有展示容量30不改，完整queueMeta/首页当前职责计102。无新全局硬cap；同人两岗仍两项，原41项中保留两次自审/签章场景。未改其它Me分支或泛化38。
3. **未确认中文缓冲离开保护**：111在原e3 Drawer未改时，真实双击格→输入中文（未Enter，cell仍空）→page.reload；5秒未出现dialog而失败，原刷新已完成、抽屉消失。`browser-review-buffer-red`保留trace/截图，`review-red-source-evidence.json`记录原Drawer SHA及guard diff/原报告hash。只在领域Drawer消费原公开 `{pending,edited}` 事件：有真实编辑缓冲纳入同一hasUnsaved，beforeunload/route/close共用；仅空焦点不算改动，提交后按原dirty处理。不改通用Grid、不持久化localStorage、不偷偷Enter或提交。

修后130桌面真实beforeunload type校验并dismiss刷新，再断言同URL/0主frame commit/中文仍在/0POST；真实关闭tab也取消且页面/文字保留。取消导航只允许实际native dismiss之后的ERR_ABORTED或Playwright TimeoutError，未知错误或真实commit都失败，不宽catch算绿。应用内取消→继续填写保持文字，明确放弃才关闭；再开空编辑器可直接关闭。两种touch浏览器验证实际app路径，不承诺移动OS强杀/所有平台tab beforeunload保留。

## 最终实际检查

证据根 `/private/tmp/jg-task20-evidence/`：

- 126–129：API类型/lint/fresh build与原相关12套529项（含公开HTTP41）全部通过，0失败/跳过。
- 130：最终18浏览器全通过（1.2分钟），原15链与新增3设备缓冲保护都实际跑于合最新MD后的源码；原45秒/0retry未更改。
- 131–134：Web类型/E2E类型/lint/UI全部exit0；lint0 errors/825 warnings。原168 Web单元项按未变模块字节保留，不冒称本次又执行。
- 135：静态PG527逻辑项（CI526+manual1）/199迁移、executed=false。原12旧创建前提仍stale未执行；未运行新3PG、真实资源driver、SQL/迁移。
- 最终治理7write/7check与369结果记录在完成段，原checker/库存预算/断言未弱化。

112包含有效新HTTP40通过与1条新增edit测试误带create requestKey被DTO拒，修正运输体后114/129全41过；113是本人替换条件时缺括号的语法前置失败，已停并核对私有PID后清理，不算业务RED；115触摸2过，桌面真实beforeunload与中文保留已发生，但测试等待已取消reload的完整load耗尽45秒，改为commit/5秒且严格观测取消（没有延长场景预算），116桌面通过。122原lint拒绝while(true)，改为有界批次hasMore终止条件后127通过。上述日志全部保留，均不替代110/111有效真RED。

只封本地复审候选，不push、不合中央、不关#402；没有真实采购/收货/付款、真实SMS银行COS、PDF额外输出、部署或生产操作。11的正式收口及原PDF失败/profile边界沿正式中央记录，本补修不重新宣称其物理PDF或实际runtime通过。

## 完成段

合正式46f935后的业务源码无再变更；r2-write-1至7、r2-check-1至7全部实际exit0，709路由/663 wrappers/702绑定/408动作0阻塞，contractMutation80路由/22展示动作。主控预留独占窗口后136原 `pnpm test:ci-orchestration` 一次执行exit0，369pass/0fail/0skip/0cancel，10841.04ms；没有延长预算或重试代理短窗口。最终提交仅本记录/PROGRESS/生成清单，源码包与完整日志hash索引存外部证据目录，handoff给出准确clean SHA/seal，不在文档自引用自身SHA。

## 9aa两轴通过后的测试证据路径补修

原9aa同Standards/Spec复审均0，报告 `/private/tmp/jg-task20-{standards,spec}-9aa014a2.md` 保留。独立merger随后只读发现截图硬编码会覆盖原作者GREEN，暂停整合。只改两行：已有case截图改用 `info.outputPath(...)`，默认outputDir改为该工作树 `apps/web-admin/test-results/task20-general-request`（已在现有gitignore范围）；标准Playwright `--output` 可覆盖，现有pnpm exec透传无需改runner。业务/交互/断言/45秒预算/0retry均未改。

证据根 `/private/tmp/jg-task20-output-path-fix-20261106-265b7bfe`。实际命令 `corepack pnpm@9.15.9 --filter @jiangkong/web-admin exec playwright test --config playwright.general-request.config.ts --project desktop-chromium --grep company_daily真实表格 --output /private/tmp/jg-task20-output-path-fix-20261106-265b7bfe/playwright-output`：1pass/8.1秒，生成唯一1366×1335 PNG于新root的case子目录，sha256 `3c37f1c27c4eea14dc1e3e9ae6f03792aa2504b423684370fbd83d4f6ddf961a`。`before-original-png.json`/`after-original-png.json`证明原目录全部37PNG（含6GREEN）路径/存在/字节/哈希集合完全不变。`verification.json`包含实际argv、默认/覆盖输出root、每张旧/新PNG哈希和业务diff0范围。

E2E类型检查及仅改动e2e/config的scoped eslint均exit0；API/Prisma/Shared/Web src相对9aa diff0。未重跑无关529/18/369，原9aa全部通过与失败保持原来源。新cleancheckpoint/sourcepacket供最小增量复核，再由独立merger在自己的唯一目录运行18项；此处未合中央/push/close。
