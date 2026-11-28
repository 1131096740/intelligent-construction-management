# 任务10：默认样张 LO 空字形成功首片

本地候选仍为 `8f7aa1e5e7eca9c297b0f3501a41b25b366f9b56` + WIP；本片待独立双轴复审，不是 #392 完成。治理 v6 原正式源码与双轴0结论保持。

## 实际 RED

`/private/tmp/jg-task10-B-empty-discovery-first-observation-20261108/receipt.json`：10.703s，当前官方 native `1d91ffe5…`，同原 O 的 DOCX `c99a5f…`、相同映射/数据/R2。新隔离 discovery 目录真实为空；字体清单仅包含未参与发现的 exact reference oracle，并未伪称已装载字体。公有上传→排队→真实 worker 标成功→授权 ticket→私有下载得到 PDF `b04a69bd…`，worker 上传1。原严格物理检查 `physical-1f7Jrd` 实测45个语义不同汉字、0个不同可绘制中文 glyph；嵌入 LinuxLibertineG TrueType 只有 `.notdef`。这是实际 blank-success，不以配置名称或 inspector 启动失败冒产品 RED。

第二份公有失败关闭期待也在未改产品前实跑失败：`/private/tmp/jg-task10-B-default-failclosed-red-20261108/receipt.json`，实际 succeeded/PDF引用反证 failed/无引用期待。全部源/私有依赖/runtime守卫保留。

## 最小修复与最终检查

仅默认版式 worker 在 LO 转换后、上传前调用只读输出检查。使用已有 pdf-lib 读取 FontFile2，zlib inflate 限64MB；校验 sfnt 目录、maxp v1/header/offset/length，发现只有 `.notdef` 的程序即安全中文错误。原失败事务/审计仍负责 failed，不重写 PDF、不加 runtime approval lock，不改 XLSX、旧生成或离线修订路径。本项只是必要输出检查，不能证明任意字体替代、所有 Unicode/glyph/outline 正确。

最终完全同四源码的执行：

- negative：5.527s，exit0；`/private/tmp/jg-task10-B-default-final-negative-20261108/receipt.json`。所选1例通过，另一互斥profile测试未选中1。
- positive：11.632s，exit0；`/private/tmp/jg-task10-B-default-final-positive-20261108/receipt.json`。所选1例通过，另一互斥profile测试未选中1。
- backend：4.779s，exit0；`/private/tmp/jg-task10-B-default-final-backend-20261108/receipt.json`。88/88，0skip。
- typecheck：17.969s，exit0；`/private/tmp/jg-task10-B-default-final-typecheck-20261108/receipt.json`。
- lint：1.528s，exit0；`/private/tmp/jg-task10-B-default-final-lint-20261108/receipt.json`。

负控：公有 job failed/R2/安全中文错误；生成上传0；失败审计1、成功审计0；维护版本仍 draft、previewPdfFileId null，latest failed且无文件引用。可信 O：真实 worker/授权下载/原严格物理/两页/浏览器全通过。两个 profile 分别运行，不能写同一环境2/2全过。最终正控的 ZIP 字节因新打包时间不同，但所有未压缩成员（含所有 Word parts）逐字节同原 c99；完整桥在外部 freeze `same-content-source-bridge.json`。

相关88首轮86过/2失败来自旧 `%PDF-converted` 伪PDF mock；只这两个队列/竞态测试改为有效 A4 PDF fixture，原断言不删、不 mock 新输出检查。最终类型检查、四文件 lint 通过。

## 保留的失败与边界

GREEN1 是 PDFRawStream lookupMaybe 类型前置失败，0tests；GREEN2 已 worker failed/0upload但本 in-memory 公有可选字段省略而非 null，修正精确投影期待。首轮可信 O 原 native/物理过、Chromium Mach IPC 权限拒绝，原日志/trace完整留；正式 auto-review 允许 require_escalated 原命令后成功，未改引擎/浏览器 flags/预算。最后补齐 maxp 目录后位置与v1长度资格后，已重新跑上述所有最终门，旧 PASS 不冒最终源码。

首共享 pre 命令 cwd错误，assert即停止无写；不冒独立 pre 守卫。实际 during/after 与原共享基线58,799项一致；最终 post另存。所有实际 run 均有 Git-visible source/private88/runtime6597或6602的 before/after 同守卫。app/worker shutdown均完成；保留证据文件，不声称已删除全部文件。

完整前像/四源码diff/精确执行与最后仅两MD桥：`/private/tmp/jg-task10-B-default-first-freeze-20261108/manifest.json`。旧生成的 Word先上传顺序、离线修订、A07、最新中央同步与整票双轴/Git仍待。未提交/推送、DB/SQL/PG/资源、部署/生产操作；#392仍OPEN，12等待10。
