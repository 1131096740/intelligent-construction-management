# 五包阶段 D：C-P0-07 零星采购全链清零回执

## 1. 结论

`C-P0-07`“零星采购申请、付款、收货、发票、退款与异常终止”已在唯一候选工作树本地确定性清零。阶段 C 登记的 29 个未覆盖生产 mutation pair 当前均为 0；本组新增的 7 个业务域上传 pair 也已同步闭环。至此 `C-P0-01` 至 `C-P0-07` 的首次上线 P0 修复队列全部清零，下一步严格进入 `C-P1-01` 至 `C-P1-04` 的只读/隐藏隔离。

整站能力矩阵仍为 `blocked`：442 条 Nest 路由中 0 条未分类，仍有 55 个未覆盖生产 mutation pair、0 个 unresolved binding 和 98 个整站 matrix blocker。剩余 55 个未覆盖 pair 与阶段 C 登记的四组 P1 数量一致，但必须逐组实现并验证只读/隐藏隔离后，阶段 D 才能退出；Task 11 的严格 0 blocker 门仍未通过。本轮没有连接生产、运行数据库/迁移或浏览器动态门、修改业务数据、推送、合并 PR 或部署。

## 2. 服务端能力与私有文件边界

- 项目级零采 capability 在当前岗位允许时发布 `create_spot_procurement`，新建申请和新建前附件上传均以精确项目和该动作复核。
- 采购、付款和收货详情分别从服务端当前业务状态、版本坐标、岗位、审批、实付、收货、差异和发票事实发布精确 enabled action；controller 可在文件落盘前复用同一读取能力失败关闭。
- 采购草稿、付款草稿、实付凭证、收货照片、退款凭证和整单发票退出通用 authenticated-only `/files`，改用 7 条零采业务域上传路由。每条路由都先校验项目或实例坐标和当前动作，再调用 `FileService`。
- 收货草稿照片额外返回当前修订可删除的精确 `photoId` 集合。重置草稿能力除草稿状态、经办人/受托人和业务开放条件外，还与写事务一致地检查复核、任意正式 PDF、差异、退款、发票分配、无票确认和发票异常事实；页面不再先放出一个必然被写事务拒绝的重置动作。
- 后端原有权限、状态、金额、审批、幂等、事务锁、CAS、收货照片锁、退款和异常终止不变量未放宽；读取 capability 是前置失败关闭，写服务仍是最终权威。

## 3. Web 失败关闭链路

下列入口均在 mutation 前 fresh 读取服务端 capability，并校验精确项目、采购、付款、收货、照片或文件坐标及唯一动作键：

1. 零采草稿新建、修改、版本生成、提交、放弃/删除和作废；
2. 采购审批单下载、草稿附件上传和工作台新建附件上传；
3. 付款草稿新建、修改、提交、撤回、放弃、重建、作废、付款主体维护、实付和审批单下载；
4. 付款草稿附件与实付凭证上传；
5. 收货草稿修改、重置、委托、提交、照片上传/关联/精确删除、主管复核与复核撤销；
6. 少货处理的发起与确认、退款登记、整单发票追加，以及对应退款凭证和发票文件上传。

放弃草稿的 `delete_pristine_draft` / `abandon_application` 和少货处理的 `initiate` / `confirm` 使用独立触发函数并冻结精确请求字面量，避免同一 wrapper 的动态分支被误当成同一业务动作。页面能力分析器同步补齐本地 `detail_action` 对象数组的透明服务端来源登记；仍要求同一次 GET、精确 key、`enabled === true` 和支配 mutation 的失败关闭链路，没有降低接受标准。

## 4. 矩阵对账

| 项目 | C-P0-06 后 | C-P0-07 后 | 变化 |
| --- | ---: | ---: | ---: |
| Nest routes | 435 | 442 | +7 业务域上传路由 |
| Web wrappers / bindings | 425 / 445 | 432 / 452 | +7 / +7 |
| 注册动作 | 209 | 243 | +34 |
| accepted action bindings | 220 | 254 | +34 |
| unresolved action bindings | 0 | 0 | 0 |
| covered production mutation pairs | 201 | 233 | +32 |
| uncovered production mutation pairs | 84 | 55 | -29 |
| unclassified routes | 0 | 0 | 0 |
| route usage blocker | 0 | 0 | 0 |
| raw matrix blockers | 127 | 98 | -29 |

覆盖增加 32 而未覆盖减少 29，是因为 29 个阶段 C 旧缺口全部关闭，同时 7 个新业务域上传 pair 被纳入并立即覆盖、4 个旧通用上传 pair 随页面调用退出而消失，净增 32。零采页面动作 blocker 和零采 uncovered pair 均为 0。

## 5. 验证回执

- TDD RED：新 Web 零采能力结构门最初 37/37 失败；收货正式事实能力测试新增 5 个失败用例；页面动作分析器对本地 `detail_action` 服务端来源最初返回 `AVAILABLE_ACTION_PROVENANCE_UNVERIFIED`。GREEN 后均通过。
- Shared Domain：15 文件 151/151。
- API 零采域：6 套 177/177，覆盖读取 capability、收货正式事实、controller 权限 metadata，以及 capability preflight 先于文件存储的真实调用顺序。
- Web 零采域：11 文件 239/239，其中新结构门 37/37。
- 能力清单与矩阵分析器：7 文件 225/225；route usage 仓库锁定基线已按新增 7 条真实页面路由更新并复验通过。
- 全仓 typecheck、lint 通过；API/Web production build、Web E2E typecheck、`check:ui` 通过。
- API 中文业务错误检查通过；Prisma Schema 在本地无连接占位 URL 下 validate 通过，未连接任何数据库。
- Nest route、Web API、页面动作、route usage、整站矩阵普通 check 与合同专项矩阵 check 通过；Web/Page/整站矩阵按设计保留 P1/P2 blocker，route usage 为 ready。
- `git diff --check` 通过。

本组没有 Schema 或迁移变化，也没有运行本地 PostgreSQL、恢复库、Playwright 或生产等价浏览器用例。阶段 E 仍须对最终冻结 SHA 重新运行数据库、四岗位浏览器、公安备案和运维安全总门；本地单元、结构和静态清单证据不能替代最终上线证据。

## 6. 下一步与授权边界

下一步严格执行阶段 D 的 P1 隔离队列：先做 `C-P1-01` 主体与相对方主数据只读，再依次处理模板治理、组织/岗位/审批委托，以及复制已放弃合同草稿。只有 55 个 P1 写入口都具备可自动验证的隐藏/只读与后端鉴权证据，阶段 D 才可进入冻结 SHA 的阶段 E。

本轮授权不包含：推送新提交、合并 PR、部署、生产迁移、生产配置/数据库/业务数据修改、Task 12 退出或任何物理删除。
