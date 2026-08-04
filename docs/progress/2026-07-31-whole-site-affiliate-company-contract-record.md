# 实施包 5 Task 11：挂靠企业线下合同登记动作闭合

## 结论

本子任务只闭合 `affiliate-company-contract.record`，不把 Task 11、实施包 5 或五包
总门禁标记为完成。

登记按钮、上传和业务登记只信任同一项目 GET 响应保留的精确
`availableActions.includes("record_affiliate_company_contract")`。打开抽屉时冻结
项目、project generation 和单次登记 UUID；第一次通过前端规范化后，表单、主体和
文件均锁定，失败重试继续使用相同内容和 UUID。项目切换、组件卸载、旧上传成功或
失败、旧登记响应、重复点击、忙时关闭及上传响应坐标不一致均不能继续写入或污染
当前页面。

服务端继续以 `contract_staff`、活动项目、项目当前挂靠企业、完整且活动的我方主体、
本人上传的 active 文件、SHA-256、唯一业务绑定、主体/文件快照、幂等指纹和同事务
审计为硬门。登记事务的共享文件绑定 advisory lock 之后，按我方主体行、文件行顺序
加锁；等待 advisory lock 后再次查幂等胜方。唯一索引竞争只在 project/actor/完整
请求指纹一致时 replay，且重新加载当前角色后返回动作，不泄漏 Prisma `P2002`。

本轮未改 Prisma Schema 或迁移。

## RED 与修复

首轮 RED 和独立复核证明并修复了以下问题：

1. registry 仍绑定 `openRecord`，不能证明按钮实际触发上传和业务登记；
2. 上传与登记是两个独立 wrapper，重试时没有冻结同一份表单、文件和幂等键；
3. 项目切换、组件卸载和忙时抽屉关闭可能让旧完成回调改写新页面；
4. 可登记的 `contract_staff` 被 GET controller 的读取岗位挡住，页面拿不到权威
   capability；
5. 文件业务绑定只取 advisory lock，未锁住同一 `FileObject` 行；主体与文件锁顺序
   也缺少活体并发证据；
6. P2002 replay 返回空角色，兼任合同主管的登记人可能丢失服务端动作；
7. 同一上传键的物理对象初版为共享确定键，失败补偿可误删并发胜方；
8. 文件事务 COMMIT 回执丢失且行稍后可见时，单次空查询会过早删除已经被数据库
   引用的对象；
9. COS PUT 已写入但响应丢失时，独占对象不会进入数据库，也没有补偿清理；
10. 分析器用源码行号压重，可被 sibling wrapper、导出共享 helper、嵌套参数遮蔽和
    伪造 call chain 绕过；capability GET 只做岗位交集，也会放过部分可写账号读不到
    capability 的页面。

最终上传协议把登记 UUID 同时作为稳定逻辑 `FileObject.id` 和业务登记幂等键，但每个
物理上传 attempt 使用独立对象 key。服务端按 bucket、文件名、MIME、大小、上传人、
内容哈希、状态和 replacement 指针核对 replay；完全一致才复用，不同内容或 actor
稳定 409。并发 loser 只能删除自己的物理对象。事务 callback 仅在文件行、上传审计
和所有 claim CAS 均完成后标记完成；进入 COMMIT 结果不明后，即使即时查询为空或
验证查询失败也绝不补偿删除。普通随机键和本次 idempotent 独占键在 PUT 响应失败时
尝试清理；结算签名合成的确定性共享 key 明确不走该补偿分支。

分析器改为只接受未遮蔽、可由双方独立分析结果互证的本地委托链；多个父 wrapper
共享 helper、导出共享 `postJson` 和嵌套 callback/function/method 参数遮蔽均
fail-close。Matrix 只在实际 inspect/write 路径重新运行 Web analyzer、stored/live
逐对象完全一致后才信任 delegation，纯 build 输入不能伪造调用链。页面动作权限门
对所有顺序 mutation Nest route（包括 position-only）求有效岗位交集，空集或策略
不可解析即失败；每个 capability GET 必须完整覆盖该集合，部分重叠不再通过。

## PostgreSQL 活体交错

一次性 PostgreSQL 16 仅绑定 `127.0.0.1:63654`，空库应用全部 109 个迁移并通过
`migrate status`。专用数据库套件 5/5 通过，其中四项真实数据库测试覆盖：

- advisory 文件业务绑定锁等待；
- 同文件跨业务竞争；
- 我方主体版本冻结与并发行锁；
- 同幂等键并发胜方 replay。

测试以双方 backend PID 和 `pg_blocking_pids` 观察真实阻塞，而非只依赖 mock 或耗时
猜测。演练容器随后已移除；普通本地回归在没有专用数据库 URL 时保留 1 项 guard
通过、4 项按设计条件跳过。

## 机器事实

- `affiliate-company-contract.record`
  - `serverDerived=true`
  - `dominatesTrigger=true`
  - `causalVerified=true`
  - mutation bindings：
    - `POST /files`
    - `POST /projects/:param/affiliate-company-contracts`
  - 两条 binding 均 `accepted=true`、`mutationCoverage=covered`
  - accepted production consumer：
    `AffiliateCompanyContractPanel.vue`
- page accepted / covered consumer：8 → 9
- page blocker：345 → 342
- matrix accepted action binding：8 → 10
- matrix unresolved action binding：37 → 36
- matrix production mutation pair：275 → 274
- matrix covered pair：8 → 9
- matrix uncovered pair：267 → 265
- matrix blocker：380 → 378，整体仍为 `blocked`
- Web manifest：376 个 transport wrapper、378 个 main binding、43 个 orphan、
  4 组重复 mutation wrapper、1 条 Web 请求无 Nest route

旧的直接 `recordProjectAffiliateCompanyContract` 导出现在只有单测消费者，因此
orphan 42 → 43，并继续作为明确 blocker 保留；本轮没有把真实旧接口删除或用委托链
伪装成已退出。该保守增长已计入上述 Matrix 净变化。

生成文件 SHA-256：

- `web-api-wrappers.json`：
  `b570994094defc1a16ac70b12a645913e8b3feb8c6c91a44ab7dc5e97e636c9c`
- `web-page-actions.registry.json`：
  `2b628cc2ff01d86f93cd1fa0a64dd658eff78f9d4cc7cb156b4d4c1e70895fba`
- `web-page-actions.json`：
  `9b39f8210de09e746c34c957c599b2a881a6db0389b3de0d032ff15d8ac51126`
- `route-usage.json`：
  `5e2b092056a415e189fe1051f7892247ba86b4f51f4653987b9af1a3499eeea2`
- `whole-site-capability-matrix.json`：
  `b03fb5461f35060fdc4a2d58a3f98b6b7c8c2fff5a9edba3f724d30ab0bae9db`
- `whole-site-capability-matrix.md`：
  `6d68f9b50affc438d8321538692a7296b28b197cfd0aa3649c92e15fc17863bf`

## 验证

- Web API wrapper 与页面：82/82；
- API file/project service、controller 与普通 DB guard：376 通过、4 条条件跳过；
- 真实 PostgreSQL 16 专用套件：5/5；
- Web / page-action / Matrix analyzer：32 + 64 + 43 = 139/139；
- 两轮独立对抗复核最终均为 PASS，无剩余分析器 blocker；
- 三个 analyzer 库 `node --check`：通过；
- Web/API typecheck：通过；
- Web/API lint：通过；
- Web `check:ui`：通过；
- API `check:business-errors`：通过；
- Web/API production build：通过，Web 仅保留既有大 chunk warning；
- Prisma validate/generate：通过；
- Nest、Web API、route usage、page action、capability matrix 五清单
  `--check`：按真实 blocked 基线一致；
- `git diff --check`：通过。

## 剩余风险、未授权与下一步

上传分布式确认仍有一个明确 P2：若独占对象的补偿 DELETE 自身失败，或事务 callback
完成后 COMMIT 最终确实回滚，会留下没有 `FileObject` 的原始对象。当前
temporary-only retention 以数据库记录为入口，不能发现这种 raw orphan。完全闭环
需要持久化上传 attempt/清理回执，或建立对象存储清单与数据库的定期对账；本轮已
确保该风险不会通过“误删可能已提交对象”来掩盖。

本地未 push、合并、部署、执行迁移或修改生产业务数据。业务草稿 purge、正式业务
记录、审计、checkpoint、旧表旧字段和物理删除继续关闭。生产 temporary-only
retention 的既有单独授权与本地 Task 11 改造保持隔离。

Task 11 仍有 36 个 unresolved action binding、265 个 uncovered production
mutation pair，以及上述 43 个 orphan、4 组重复写、1 条 stale 请求和 26 条未分类
路由。下一切片必须重新选择一个边界清楚的 blocker；不得把本动作局部通过扩张为
Task 11、实施包 5 或整站发布门已完成。浏览器 P0、全量测试和最终发布候选证据继续
在后续 Task 11–15 总收口执行。
