# 任务10：旧生成与离线修订 LO 空字体输出后继

本地 `8f7aa1e5e7eca9c297b0f3501a41b25b366f9b56` + WIP；默认首片 e142 已双轴0，治理 v6 已正式0；本后继五源码待独立双轴，不是 #392 完成。仅修改合同 worker 调用面，原只读输出 helper `40c897…` 不变。

## 两路实际 RED 与修复

- 旧生成：`/private/tmp/jg-task10-B-legacy-third-observation-20261108` 真实历史 pending 完整旧 snapshot/独立 tuple/R_F，公有 GET 重复恒等后封测试 store 外部访问，再实际 worker。原 success、Word/PDF 两生成上传，私有授权下载 PDF `0b2505…`；physical-AqnXQs 实测46语义不同汉字、0可绘制中文 glyph。随后 `/private/tmp/jg-task10-B-legacy-public-failclosed-red-20261108` 在未改产品前证明 failed/0upload 期待失败。
- 离线：`/private/tmp/jg-task10-B-offline-historical-observation-20261108` 公有原文件上传后，明确合成既存合法 source generated snapshot/R_F、open round、queued revision/comparison；实际 worker 原 succeeded、生成 PDF1，通用 FileService 原授权 ticket/download200可达，PDF `1789cc…`；physical-IpjabT 实测49语义不同汉字、0可绘制中文 glyph。`/private/tmp/jg-task10-B-offline-public-failclosed-red-20261108` 是加该调用 guard 前的公有失败期待真实 RED。

两路都用当前同一官方 native `1d91ffe5…`、原坏 discovery manifest `381e0520…`，不是借 inspector 启动失败、切 engine 或 runtime approval policy 冒 worker 拒绝。模板输入 `70a46a4249e96abf311cdefc65cf4bac75a7297b6afcbed40a5198eeb7b17a14` 与离线原输入 `51a2dc38f81506cfc86f5cd18d0b223b3e097cab6b189e722b29669ed6003f59` 分别绑定；不是拿默认 c99 当另外两路源。

旧生成最小调整为 LO 转换→原 helper 校核→原 normalize 全部完成后才上传 Word/PDF。docx4j 分支保原引擎、转换/normalize/最终 bytes 路径，snapshot/renderer/profile/key 不改；没有把旧 pending 改为新 engine。离线只在原 LO 转换后、normalize/新 PDF 上传前加同 helper 一行。失败沿原事务/audit，不改用户已上传输入的所有权。

## 退役入口与历史 fixture 的限制

先实跑 release-a 真实 POST，仍在全局 RetiredWriteEntryGuard 前410（`/private/tmp/jg-task10-B-offline-first-observation-20261108`），不是字形 RED；原 ContractCutoverGuard 并非唯一守卫。未删 guard/名单、未直调 service 写方法、未发明可写 compatibility 入口。

后经明确历史 worker 授权，fixture 只在准备窗口登记既存持久事实；两模式 release-a/release-b-maintenance 下 open round、offline upload、retry、专用 preview-ticket 共8个 POST 均实际410/OLD_WRITE_ENTRY_RETIRED，GET 仍走真实 NegotiationService。仅 opt-in fixture 注入该原服务的只读入口、增加原两个 in-memory 表映射；默认 options 不变，无 SQL/DB。封 `server.store` 后仅真实 worker/公有 GET/通用文件 ticket。通用票据确由原 FileService authorizer 放行，没有权限绕过；它证明当前经办人可读该已处理历史文件，不证明退役专用票据恢复。

离线失败后 public hasPreviewPdf=false、comparison failed、新生成上传0、失败audit1/成功0；用户原上传 input 用原通用授权下载 hash不变、历史 source 公有记录全等。原 input 明确不计 worker 输出。旧生成失败 public docx/pdf null、snapshot full equal、0生成上传、失败audit1/成功0；可信 success 仅允许原有 inspection={pageCount:1,pageSizes:[A4_portrait],warnings:[]}附加，R_F/renderInput等字段保持。

## 最终同源执行

- bad：7.196s exit0，`/private/tmp/jg-task10-B-remaining-final3-bad-20261108/receipt.json`。各profile所选3例通过、互斥1例未选中；不冒单环境4/4。
- good：12.324s exit0，`/private/tmp/jg-task10-B-remaining-final3-good-20261108/receipt.json`。各profile所选3例通过、互斥1例未选中；不冒单环境4/4。
- backend：5.547s exit0，`/private/tmp/jg-task10-B-remaining-final3-backend-20261108/receipt.json`。114/114，0skip。
- typecheck：17.071s exit0，`/private/tmp/jg-task10-B-remaining-final3-typecheck-20261108/receipt.json`。
- lint：1.638s exit0，`/private/tmp/jg-task10-B-remaining-final3-lint-20261108/receipt.json`。

可信 profile fb7cfd/current native1d91：默认真实 browser/下载/物理通过，旧生成与离线通用授权真实下载 hash绑定 worker 输出，三物理分别 WcKASV/Nt9jlf/PExNr2 均 GREEN。原输出检查是拒绝仅.notdef字体程序的必要条件，不能声称任意 wrongglyph/Unicode覆盖均已证明。原 worker130s/native120s/准备170s/runner600s 未提高。

五执行10个 before/after 的五变更源码+原 helper 六路径同最终；原私有依赖88/runtime6597或6602守恒；共享58,799项前后同。最终仅 PROGRESS 与本MD写入后桥接，不借旧源码 PASS。

`actual-pair-provenance.json` 对每路分别绑定首RED与最终可信实物。旧生成/离线输入 raw ZIP 字节分别相同；各独立运行的合成 owner/version/file/layout ID、时间、完整 frozen source 差异逐项记录，不冒同 owner/R_F。旧生成 renderInput 只出现记录在案的自然 temporaryCode 差异；其它 render values相同。默认 raw ZIP 新时间不同但每个未压缩成员都完全相同。未用宽 filter 或虚构预期 PDF 替代真实下载。

## 原失败与余门

legacy first 是 TS 前置0tests；second 误封 store.prisma 影响原 transaction，改封 server.store 后才取得真实 glyph RED。离线首 POST410 仅退役守卫证据。114首92过/22失败大部是旧 `%PDF-converted` 非PDF mock，换原成功 fixture 为有效 A4 PDF并保 normalize 输入断言后113/114；原PDF失败前Word1上传的期待按新必要0上传改正，空 cleanup helper 实际 calledWith([],owner) 是0文件操作，不能写0 helper calls。final2 good 只有新增 snapshot 全等期待忽略原inspection附加而失败，保原件，非产品新RED。所有旧收据/source checkpoint均完整保留。

app/worker shutdown均settled，测试证据与原上传文件有意保留，不声称全文件删除。未改 shared Schema/权限/业务API、docx4j/renderer、XLSX、治理44dcc/631677、CI库存或旧success文件。未提交推送/main、SQL/PG/资源、部署或生产操作。后继仍需本片双轴、A07、同步 root 已核中央0d563bb565b7229d3488c2ffcc5e379dae953a8e、整票检查/双轴/Git；#392仍OPEN、12等待10。

完整前像/精确patch/执行与文档桥：`/private/tmp/jg-task10-B-remaining-final-freeze-20261108/manifest.json`。
