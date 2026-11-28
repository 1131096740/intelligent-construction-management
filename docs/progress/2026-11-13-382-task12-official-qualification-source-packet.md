# #382 / #394：官方文书工具资格的离线SOURCE封包

本轮继续等待正常付款新单次授权，同时完成不依赖该授权的文书工具资格材料。仅源码构建、正式JS样张生成及FS/Git核验；没有执行实际Java/LibreOffice转换、Python实物检查、SDK引擎、数据库、daemon、COS或生产操作。付款与本方案属于不同工作树/运行目录/许可，不能互相授权。

## 准确绑定

源码 `e9006c603ba2282a961641b24b86c374d6c20589`，树 `a7e2c6cded34695a2d960ab2bc856eeaee51e2df`；自有工作树 `/private/tmp/jg-394-official-runtime-profile-20261113`，分支 `codex/394-qualification-packet-e900-20261113`，clean。已有准确CI43370833128为32项全部成功，仅作为源码CI，不能代替工具资格。

封包根 `/private/tmp/jg-394-qualification-e9006c60-20261113-H859H7`：

| 材料 | SHA256 |
| --- | --- |
| plan.json | `5b05b1f4d17fe07589af46f089fdf988c6fc2221299cef895ea604b253118bca` |
| request.json | `0790452e37ee558479d186e86155034f18fefec620c50aaef6d8c47dac5a23d3` |
| build.json | `491e45ef7d4cf191b9ed26f4b0b6da641bb6de676a950259901839e2d425eddf` |
| 固定工具材料 | `b4358d6bdd5055fe14cb17051e0d9e0770de4b9b78b8ee140a14e3bd5c4cde45` |

源码见证3926文件、摘要`58e27556458c7a544ca8e86e751447aaa8a94fc4575e846ce6d622cafdd73a4d`；构建记录68073项。使用新官方Temurin profile，候选锁`cfdb0f202e91294db06aa8643be7955be6760a37b97d90c6baf9c261c76f0c45`；旧JDK树不匹配及原停止历史完整保留，没有放宽旧锁。

## 本轮执行与独审

三门各仅一次：`--build` session2708、`--prepare` session71322、`--verify` session60220，均exit0、stderr空；原命令、输出及终态在 `evidence/`。静态调用闭包证明三门不进入实际转换/检查分支，记录 `/private/tmp/jg-394-qualification-e900-closure-20261113.json`。未重复generate或改vendor JS，自有依赖56302常规文件nlink1、2473内部链接，无跨树借用；原SOURCE回执和封存付款/88材料未修改。

正式公开编译producer生成material.docx、office-preview.docx、line-box-scope.json及独立EXPECTED.json；预期来自固定源样张，不从未来PDF产物反推。计划及样张hash在 `SEALED-SOURCE-MANIFEST.json` 逐件绑定。独立Standards机械复核源码/构建/工具完整树/样张和命令，0可操作发现：`/private/tmp/jg-394-qualification-e900-independent-20261113/REVIEW.md`、`PROVENANCE.json`。独立Spec复核，0可操作不一致：`/private/tmp/jg-394-qualification-e900-spec-review-20261113.md`。两者只读，未重跑项目helper或任何实际资格程序；作者三门结果仍归作者。

## 待授权的后继与未完成范围

`ONLY-PROPOSED.md`、`ONLY-PROPOSED-COMMAND.json`提供唯一未执行qualification命令，固定private HOME/TMPDIR、UTF8、OS拒绝网络、Node20及计划摘要；总预算315000ms，Java/LO各120000ms、每个实物检查25000ms原样。后继若获新的明确授权，才按negative→Java→实物检查→LO→实物检查→既有normalize→实物检查的顺序一次执行；任一首错停，不重试或修复后继续。

当前run为空，无attempt/机器回执，registry仍null/PENDING，runtimeAuthority不成立。即便未来机器资格成功，独立三件PDF页数/签字/分页人审、受审登记/新CI、真实SDK moduleView正向、生命周期实际链仍是后继门；本包不覆盖完整五类型×三关系、COS/browser、通知竞态或后两轮PDF语义缺口，600/628限制保持。#394/#398仍OPEN，不将SOURCE准备或CI成功写成实物、运行时或全部45任务验收。

本轮没有新actual授权；现有正常付款问题仍待用户答复，不能挪用于文书工具。源码/依赖/构建/封包保持冻结；本页与PROGRESS的CI后状态先作本地文档记录，不改已绑定的e900候选。
