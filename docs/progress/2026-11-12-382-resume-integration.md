# #382 接续与 native 清理修复

2026-11-12，北京时间。用户授权按 implement-spec 持续完成 45 个依赖任务。

## 图与来源

GitHub 本轮回读 14/45 已关闭；仅 #394 与 #398 前置全部关闭。其余 29 个未完成任务继续遵守依赖图，未提前关单。根混合工作区及其旧 PROGRESS 未改；接续工作树为 `/private/tmp/jg-382-integration-resume-20261112`，分支 `codex/382-integration-resume-20261112`。

远端草稿 [#428](https://github.com/1131096740/intelligent-construction-management/pull/428) 回读头 `89d503223c330996a8c4ffd66b18c253f1da83b1`；该提交 [CI 43226819627](https://github.com/1131096740/intelligent-construction-management/actions/runs/43226819627) 的 32 项检查均成功，包括 PostgreSQL 动态组与发布门。CI 不替代 #394 私有存储/完整生命周期，或 #398 一次性故障、竞办和独立核账的实际业务回执。

独立审查本地后继 `33741e44b2f1393887c3bcc19cc14dd674c3730a`（是 89d 后代，包含既有 4b2aff5c），未修改其作者树。51 路径增量无 Schema、迁移 SQL 或锁文件变化。Standards 发现下述清理缺口；Spec 无新增可操作发现，真实验收保持未完成。独立准确 337 的 16 套脚本 486 项、3 套 API 134 项、API 类型与 lint 通过，未冒充全量或新提交 CI。

## 修复及独立复验

作者提交 `acc6b999bde1e12a90cdd2a80a4cbcae20895f43`，树 `083a0b9846b40180400d33cef614c342ebb9a058`。仅修改 native 生命周期 runner 和对应现有测试。

原 `docker run` 若已在 daemon 创建容器却在返回 ID 前超时，会跳过原 `if(container)` 清理。修复以本轮精确名称查找，核标签及 ID 后才删除；未知归属拒删并报清理失败。私有目录清理仍独立尝试，原首错不被诊断或清理异常覆盖。独审补充的“已知 ID 对应容器改名、原名称查询为空”反例也先红后绿，保留最终 ID 不存在核验，防止误报清理完成。没有重试创建容器。

作者 15 项无资源测试、API 类型/lint、语法与差异检查通过。merger 在准确 acc 上独立复验 15/15、0 skip，通过后将接续分支从 89d 快进到 acc，保留所有祖先。

外部详细证据：

- `/private/tmp/jg-382-resume-394-20261112.md`：作者 RED/GREEN 与后继负控。
- `/private/tmp/jg-382-review-337-STANDARDS.md`、`/private/tmp/jg-382-review-337-cjs.log`：Standards 及准确父源复验。
- `/private/tmp/jg-398-plan89d-20261112/SPEC-REVIEW-337.md`：独立 Spec 审查。
- `/private/tmp/jg-382-resume-integration-20261112.md`：来源与合并交接。

## 剩余边界

本轮未执行 Docker/VM、数据库/迁移/SQL、实付业务、COS、短信、部署或生产操作。旧 214 与旧实付尝试均有已消耗记录，不复用许可、不重跑。新准确候选需先封存 source-only 方案并校验，再取得实际隔离资源和迁移执行授权；单个正常实付场景通过也不等于 #398 整票完成。

草稿保持草稿；未将未完成票据标记完成，未合并 main。后续 GitHub 推送及 CI 必须另记准确提交，不沿用 89d 的成功结果。

## 新 CI 首错与最小修复

本轮将含进度文档的 `b0927040eec86df5f1ccfe957bba0511e4497e40` 推送到原草稿 #428，GitHub 回读一致。[CI 43248322590](https://github.com/1131096740/intelligent-construction-management/actions/runs/43248322590) 的动态门在资源执行前报“任务01固定执行源码哈希不匹配”；构建安全两项与编排十六项失败均为同一前置原因。没有将旧 89d CI 成功移用于 b092，也没有重跑已消耗的本地单次入口。

已审 helper 在 89d→337 的身份资格、只读 relay 生命周期和有界诊断变更未同步到固定摘要登记。`b020e78212d8d7520311b52a39550b0e65e87759` 仅更新 `/coveredGroups/22/runner/resourceHelperSha256` 一字段，新值与已审文件实际 SHA256 相等。独立 JSON 深比较确认其他字段和所有执行守卫不变。公开清单验证先红后绿，返回 261 条迁移、22 自动组、78 文件、540 项与独立手动组；篡改源码负控仍在原哈希守卫拒绝。作者原 dispatcher 80/80、独立构建后的清理安全 74/74 通过。首次作者隔离树缺依赖或 dist 的失败日志保留，不计作通过。详见 `/private/tmp/jg-398-source-pin-HANDOFF.md` 与 `/private/tmp/jg-382-merger-b020-20261112.md`。

b092 后端分片另有 `local-postgres-volume-cleanup.spec.ts` 对 native runner 检查失败：`row[0]` 的内层方括号不符合既有静态提取边界。`e64bc066ada469a7fe279ce861a74e4e8b54ce85` 仅在全部原归属核验之后将该 ID 绑定到 `containerId`，原样调用按 ID 删除且带 `--volumes` 的命令。未修改解析器、白名单、测试规则或实际清理权限。原安全套件 44 过/1 失败后转为 45/45，native 15/15；作者 API 类型/lint 通过，独立审查者在准确 e64 再跑 45+15 均通过。日志为 `/private/tmp/jg-382-review-e64-safety45.log` 与 `/private/tmp/jg-382-review-e64-native15.log`。

b092 的 source-only 正常实付 261 方案已准备和独立校验，但因为新 CI 与后继源码变化继续 HOLD。旧方案与空运行目录保持，不能用作后继提交的许可或实际通过。最终文档提交之后另封新方案，不自动执行实际资源、迁移或业务。
