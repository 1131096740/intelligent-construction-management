# 2026-08-05 Go-Live Conditional Go 收据

## 结论

- 发布候选：`733ddb8192b95d11043c67da8b6e3965ec784680`
- PR 合并提交：`308c47b51c368a4573c9857411e59a872e1e5062`
- 决策：`Conditional Go`
- RC-09/阶段 F 回滚范围：同一正式生产主机上的 localhost 隔离槽位，完成部署 -> 回滚 -> 再部署。
- 正式生产业务数据：演练未修改。

负责人接受当前单机部署限制，同意在上述范围内将 RC-09/阶段 F 回滚门判定通过。整机故障、跨主机接管以及 DNS/网络故障转移没有演练，继续作为已知残余风险，不得描述为完整灾备已验证。

## 候选与门禁

- 精确 SHA CI run `30983116060`：成功，`headSha` 绑定候选 SHA。
- 部署 workflow run `30985013271`：成功，部署输入与日志使用候选 SHA；workflow 自身位于合并提交。
- PostgreSQL 16 动态总门：118/118 migrations、54/54 tests、28/28 files、9 groups。
- 四类硬门：Web API manifest 432 wrappers/452 bindings、页面动作 241 actions/0 blockers、route usage 446 routes/0 unclassified、capability matrix 446 routes/0 blockers。
- RC-06 隔离业务链：合同 -> 结算 -> 付款完整链和 20 个治理场景通过，`productionData=false`、本地文件存储、隔离 PostgreSQL。
- RC-06 浏览器：Chromium `1366x768` 与 WebKit `390x844` 共 6 项通过；五类岗位、400/403/409/503、上传幂等和下载内容回读均有证据。
- 生产写冻结探针：冻结应用与恢复成功，冻结期间受控写请求稳定返回 HTTP 503 / `OPERATIONAL_WRITE_FREEZE_ACTIVE`。
- 生产只读核验：候选 SHA、干净工作树、API/Nginx active、health/readiness 正常、冻结锁不存在、自然异机备份有效。

## 同机隔离回滚演练

演练只在 `127.0.0.1` 绑定的临时槽位进行，使用隔离数据库和本地文件存储。正式 Nginx、正式 API、正式 PostgreSQL 业务库和正式业务文件未切换到该槽位。

| 阶段 | 运行 SHA | 结果 |
| --- | --- | --- |
| 旧版本启动 | `a350a91df71deef5f37fc5782fc99452ff103eb9` | health/readiness 通过 |
| 部署候选 | `733ddb8192b95d11043c67da8b6e3965ec784680` | health/readiness 通过 |
| 回滚旧版本 | `a350a91df71deef5f37fc5782fc99452ff103eb9` | health/readiness 通过 |
| 再部署候选 | `733ddb8192b95d11043c67da8b6e3965ec784680` | health/readiness 通过 |

临时工作目录、数据库、角色、进程和 localhost 端口在演练后清理；正式生产 HEAD、API、Nginx、health/readiness 和备份检查保持正常。

## 已知残余风险与补偿控制

- 未验证整台服务器不可用时的自动或人工跨主机接管。
- 未验证 DNS、入口网络或云主机级故障转移。
- 完整写业务链在隔离 UAT 完成，不等价于使用正式生产业务数据执行端到端写入。
- 当前补偿控制为自然异机备份、校验与隔离恢复能力、写冻结、同机版本回滚、健康/readiness 门和人工重建流程。

发生主机级故障时，必须先停止业务写入，核对最新异机备份与校验收据，再按重建和恢复 runbook 处理；不得以本次同机演练替代跨主机灾备声明。
