# POL-108 授权上下文与同机配对测量

## 范围与准确基线

- 用户批准：先补齐观测和同一 runner 配对测量，再验证相同授权上下文不重复更新；保留逐次密码验证、全部测试和业务校验；不动幂等查询，不部署、不操作生产。
- 本地实现与诊断完成后，用户已授权提交、推送、创建 PR，全部 CI 通过后合并，并核对 GitHub 分录组收益和事实组是否持续变慢；明确不部署、不操作生产。
- 基线：`2b81d01fcadca901d936cdfc0b21b8563cd1c6b1`，PR #339 合并提交；候选 `cad44c228a6b16a38cc5443e81db2e4c7fc3b0ca`。
- 只读复核：[PR #339](https://github.com/1131096740/intelligent-construction-management/pull/339) 已合并；[main CI 39239200815](https://github.com/1131096740/intelligent-construction-management/actions/runs/39239200815) 25 个 job 全部成功。本轮结果不能冒充新的 GitHub 提速结果。

## 改动

1. 正式 POL108 runner 输出 CPU 型号/核数/配额、镜像 ID、容器 cgroup CPU/限流/内存/IO 计数、Linux 宿主机 CPU/压力累计计数、上下文插入/更新/HOT 更新、WAL 增量、数据库 IO 与每 5 秒一次聚合等待事件/函数计数；阶段计时增加 Node CPU 与内存。未采集 SQL 文本、参数、用户身份或密钥。
2. 探针串行，停止时等待在途探针；不支持的资源字段标记 null，采样错误单列。正常/失败路径逐条输出历史样本；最终探针失败也保留已采集样本和原始错误。样本不能直接解释为等待耗时占比，聚合统计可能延迟发布。`/proc` 压力和 CPU 计数属于 Linux 宿主机/本机 Docker VM，不等同于 macOS 全机负载或单个查询耗时。
3. 新迁移 `20261019140000_operating_context_noop_update` 仅为授权函数的冲突 UPDATE 增加类型匹配的 `IS DISTINCT FROM` 条件。每次仍读取当前密钥哈希、执行 `crypt`、清理过期上下文；操作人变化仍更新。`CREATE OR REPLACE` 保留函数身份、owner/ACL、SECURITY DEFINER 与 search_path。
4. 比较已存储时间戳与同列类型的 EXCLUDED 时间戳，避免 TIMESTAMP(3) 精度导致误判。仍保留冲突检查和行锁，不声称跳过锁或缓存授权。参见 [PostgreSQL 16 INSERT](https://www.postgresql.org/docs/16/sql-insert.html)。
5. 原14项业务测试、20001/100001边界、逐条受控写入、幂等查询、权限、事务、断言及超时保持。新增授权边界回归嵌入原经营账真实 PG 用例。

## 测量设计

- 同一台本机执行器：Apple M5 Pro、18 逻辑核、约48 GiB内存，Node v20.20.2；Docker PostgreSQL16原生arm64。
- 固定镜像 `sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d`，每次全新临时库/容器，`--cpus 2 --memory 2g`，track_functions=all、track_io_timing=on。
- 两侧复制相同观测 helper 与原14项用例；优化侧仅数据库授权函数变化影响分录测量。依赖、构建产物复用同一来源。每轮 migrate deploy 两次、原 seed、原 Jest 身份/数量核验；测量前后源码指纹必须一致。
- 完整分录配对顺序：旧→新、新→旧、旧→新，串行运行，不并行启动其他构建/数据库测试；随后两侧执行 core12项和facts1项，连同重复分录测试覆盖原14项。
- 测量使用 `/private/tmp/pol108-context-measure.cjs` 和固定快照 `/private/tmp/pol108-context-before`、`/private/tmp/pol108-context-after`。正式 runner 的准确提交/干净工作树门禁不变；本轮是 source fingerprint 绑定的 local_diagnostic，acceptanceEvidence=false。
- 快照固定后，正式 runner 的日志呈现/失败路径及对应 VM 测试进一步修复。首轮 GitHub CI 另发现受控子进程未继承 GITHUB_ACTIONS 时被误标 false，现将缺失/非法标记报告为 null，不扩大环境变量继承；真实 CI 来源仍绑定 workflow 与 SHA。该 helper 元数据修复不改变探针、业务用例或 SQL。最终分别核验这些文件一致性，不能将临时快照整体指纹视为最终提交 SHA。

## 测量结果

| 配对 | 顺序 | 基线总耗时 | 优化总耗时 | 总耗时下降 | 写入耗时下降 |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | 旧→新 | 11分16秒 | 10分04秒 | 10.60% | 10.76% |
| 2 | 新→旧 | 11分23秒 | 10分02秒 | 11.86% | 12.31% |
| 3 | 旧→新 | 10分53秒 | 9分51秒 | 9.44% | 9.63% |

- 三组配对均通过。基线总耗时中位数 11分16秒，优化中位数 10分02秒；配对降幅中位数 10.60%，范围 9.44%～11.86%。这是本机分录组结果，不代表 GitHub 整条流水线提速。
- 每轮业务幂等查询100001次、授权100035次、crypt100036次、受控分录写入100021次（含夹具），逐轮一致。crypt总数包含夹具的一次密钥哈希生成，实际授权调用100035次均继续校验密码；上下文插入14次保持，UPDATE由每轮100021次降为0。切换操作人的实际更新另有真实PG断言，不是禁止所有上下文更新。
- 授权函数self_time：基线 37.951～43.723 秒，优化 3.255～3.679 秒。crypt总耗时六轮范围 402.809～406.718 秒，执行次数未减少。
- WAL增量：基线 153.231～153.375 MiB，优化 136.551～137.334 MiB。缓冲区命中计数下降、数据库CPU时间降低与减少行版本维护一致；不把所有余项耗时归为网络。WAL/FPI也会受checkpoint时点影响，不将全部字节差值单独归因于同值UPDATE。
- 六轮累计限流时间各为 0.139～0.214 秒；共 740 条定时样本，采样错误0，deadlocks0、wal_buffers_full0。样本只表示采样瞬间，不能直接换算等待时间百分比。
- 旧实现三次总耗时范围 10分53秒～11分23秒，同机仍有波动；不能据此追溯确定此前两个GitHub runner的波动根因。新增观测用于后续准确提交的CI分析。
- 原14项在两侧全部通过：core12、facts1、impacts1；分录用例各额外重复两次。所有结果无跳过，测试身份/数量与源码不变检查通过。
- 基线快照源码指纹 `c0c1fc1d61ac71d4f0759ae0332a10b7ce0f2c38a7cb50dab39684de4908991d`；优化快照 `15f05255f0398ebd6013a86094889792b98042a65e43840aa611b46c6468ad5a`，每轮前后一致。观测helper和原POL108用例两侧逐字节一致；最终业务用例与测量快照一致，helper 仅缺失环境标记由 false 改为 null；提交差异检查另去除新迁移EOF多余空行并同步清单校验和，SQL语义不变。
- 原始数据见本机 `/private/tmp/pol108-context-pair-*`、`/private/tmp/pol108-context-before-core`、`/private/tmp/pol108-context-before-facts`、`/private/tmp/pol108-context-after-core`、`/private/tmp/pol108-context-after-facts`；配对驱动日志 `/private/tmp/pol108-context-paired-series.log`。本记录旁的JSON仅保留无秘密的计数、指纹与耗时。

其他分组仅各运行一次完整回归，不据此宣称稳定提速：

| 分组 | 基线 | 优化 | 原用例结果 |
| --- | ---: | ---: | --- |
| core | 0分29秒 | 0分27秒 | 两侧12/12 |
| facts | 7分11秒 | 7分29秒 | 两侧1/1 |

事实组本次单对耗时增加4.07%，没有测得收益，原因尚未确定；不能把分录组三组一致的正收益推广到事实组或整条CI。事实组授权函数self_time约1.60→2.06秒、crypt约161.46→164.04秒，增加幅度不足以单独解释总时间差，仍有其他数据库/客户端及环境耗时。只有一次事实组配对，不能确定该差异由本次SQL变化导致，也不能把它直接当成纯噪声忽略。原始结果保留，后续固定提交CI需同时关注该组。

## 回归与失败保留

- 首次临时测量在源码指纹阶段因依赖目录符号链接被纳入而报 EISDIR，尚未执行业务测试，不计入配对；修正快照 exclude 后启动 valid 第一轮。原失败 `/private/tmp/pol108-context-pair-1-before-driver.log` 保留。
- 新 no-op 行版本断言在旧实现真实 PG 下失败（ctid由(0,1)变为(0,2)）；新迁移下通过。原失败 `/private/tmp/pol108-context-red/ledger/run.log`。
- 真实 PG 经营账1项 + 项目收口/HTTP8项全部通过。补充同值不更新、错误密钥、同事务密钥轮换、切换操作人、跨连接/跨事务隔离、过期清理和事务回滚断言。
- 观测测试：缺模块、Jest失败丢样本、末次探针失败丢样本反例均先失败，修复后7/7通过。原错误保持。
- API typecheck、lint通过；服务测试76/76通过；迁移清单176个目录、终端迁移校验和一致。
- 首次编排在中文工作树308/309，原有 controlled-runtime-exchange.test.mjs 使用 URL.pathname 导致编码路径错误；同源英文隔离快照309/309通过，不改无关测试。加入末次探针失败回归后，最终英文路径310/310通过。
- 双轴审查先发现失败路径观测缺失，修复并保留反例；最终 Standards 与 Spec 复审各0项遗留。

## 交付状态

本地实现与配对测量已完成，用户授权的固定提交、双轴复审、PR、候选与合并后 CI 正在推进。GitHub 实测和准确 SHA 收据将登记于本轮 PR；未取得结果前不宣称云端提速。无部署/生产操作。


## GitHub 首轮验证与最终收据入口

- [PR #340](https://github.com/1131096740/intelligent-construction-management/pull/340)，首候选 `af426b6a8abae91c3ca664b9811a6b54180e270f` 的 [CI39253274597](https://github.com/1131096740/intelligent-construction-management/actions/runs/39253274597) 25/25 成功；原 core12/facts1/impacts1 全部通过。
- 按 job 自身起止时间（不含排队），分录648秒、事实536秒；此前PR339/main同树两轮分录599/780秒、事实505/501秒。首轮分录处于旧范围内，不能单凭它宣称稳定云端收益；事实比旧两轮慢6.1%～7.0%，保留为待后续轮次判断的回归信号。
- Jest套件耗时：分录562.085秒、事实444.929秒；分录写入539.181秒，授权函数self_time4.810秒（旧30.866/44.663秒）、crypt362.982秒（旧317.744/396.381秒），授权100035/crypt100036/业务幂等查询100001次均保持。上下文插入14、UPDATE0，110次采样错误0。
- 事实写入421.340秒（旧404.298/394.051秒），授权self_time2.839秒、crypt145.378秒；授权40033/crypt40034次保持，UPDATE0，87次采样错误0。与旧main的crypt145.135秒接近，不能把全部差异归于密码哈希。
- 新观测确认此轮两个大分组均为AMD EPYC7763、4逻辑核、约16GiB，镜像ID与旧两轮相同；容器CPU限流增量0、WAL buffers full增量0、deadlocks0。旧两轮缺完整资源观测，无法据此做同机因果归因。
- 首轮受控子进程缺失GITHUB_ACTIONS而记录false，只影响来源元数据，真实来源以该workflow/SHA为准。最小反例先失败（false != null），修正为缺失/非法值null后，相关11项通过；不扩大环境变量继承，不改变业务/探针/SQL。原始失败保存在本机临时证据目录。
- 最终准确候选与合并后CI、分录组和事实组各轮完整对比，持续补充于上述PR收据，不把首轮结果冒充最终SHA结果。无部署、生产迁移或生产操作。
