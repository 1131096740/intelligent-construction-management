# 受控首发：执行范围与阶段退出

用户于2026-10-13确认“受控首发，复杂自动发布机制延后”。目标是现有公司业务上线；AI实施技术工作，所有者批准重要生产阶段。本文不是生产执行授权。自动POL25A/POL25B入口、原验签与isolated-local限制不变；不向它们输入人工或合成收据。

## 版本及上游关系

首发候选基于dc828ec21c0b891609e98ddebe2ee4d503868405，包含主线业务、备份连接安全、手机维护交互和失败附件修复。新增恢复连接保护、后台冻结/排空及受控运行文件交换。最终提交尚未获准，不把这个基线SHA当修改后版本。

保留#296兼容迁移→#122测试业务处理→#123维护部署→#124开放顺序及同候选绑定；每阶段保存真实原材料与前后摘要并引用前阶段摘要。用户批准人工核验替代辅助自动签发/见证体系，只用于这次受控首发；不放宽金额、权限、Schema、测试来源或可恢复条件。不得凭本地通过关闭生产Issue。

## 固定目标及材料来源

- 服务器：既有jgzg-prod访问；既有生产路径/单位为`/opt/jiangkong`、`/srv/jiangkong/apps/api`、`/srv/jiangkong/apps/web-admin`及`jiangkong-api.service`。Git操作使用ubuntu，私有配置/维护控制用获准root阶段，不复制root或部署密钥。
- 腾讯云最终账号100049377606；成都业务桶jiangkong-prod-files-1438687719、备份桶jiangkong-prod-db-backups-1438687719。不触碰第三桶或辅助CAM策略/账号。
- 机器/数据库身份与真实角色、HBA、五项service/timer及三Cron绑定原材料：已获准阶段A的私有`original-output.json`，摘要beed4875130fdd5941f8f7bb1b1c206ffcf1a3ca0c8010dad6899873db06e611。它是2026-10-13历史观察，执行阶段须重新比较；不宣称当前持续停写。
- 尚缺最终候选SHA、同SHA完整17门、现场配置/运行文件before全文摘要、当前完整备份及恢复材料、最终附件清单、当前实际COS业务写权限。它们分别来自固定提交/最终验收及下述生产阶段，缺失即不渲染正式写入命令。

## 阶段一：维护、备份身份及完整恢复

集中批准范围须明确：核验目标，保存配置/单位/Cron/HBA和权限原字节，暂停API和两类维护任务，临时隔离三条备份调度，排空在途；旧02:30行保存并暂不退役。不是停全机cron。

使用阶段A实际绑定生成准确的行级Cron修改；前摘要不符、匹配不是三条或其他行变化即拒绝安装。先停止timer，再SIGTERM停止service并检查实际cgroup/PG连接和任务，不只看inactive。持有期间持续检查每项状态、连接/事务及附件写来源。管理员/root和外部客户端不能由NOLOGIN假装已隔离；维护期间只执行批准脚本，不进行额外手工业务写。无法界定的写源即停止。

DB维护采用保存完整HBA→准确拒绝非维护入口→排空旧连接的既有本地验证方案；保留明确的备份/恢复只读路径。单次NOLOGIN不算持续停写。COS只控制实际业务写主体和业务桶；备份桶允许准确备份身份上传，不扩权应用，不依赖延后的辅助CAM读取身份。实际策略/ACL原文和当前写主体未固定之前不得执行拒写策略。

正式备份使用`run-production-db-backup.sh`，独立root私有连接`/etc/jiangkong/db-backup-database.env`，不回退API连接、不排除受保护表。既有helper的PUBLIC EXECUTE最小权限修正及新备份身份必须在准确原权限核验后单列入本阶段批准。口令现场生成并仅留0600文件，不能写进argv、聊天或Git。

隔离DB恢复使用`db-restore-drill.sh`，目标必须`jiangkong_restore_*`且为空；dump/sha256核验、迁移状态和完整业务/安全表读取保留。附件用`private-object-backup.mjs capture-and-verify`，从完整实际清单取得对象内容，校验大小/摘要/版本并恢复至独立目录；失败不得把部分清单写成完成。恢复演练不覆盖生产DB或业务桶。完整内容可恢复及一致性成功后才能继续。

窗口最大时限须根据备份量/隔离恢复实测固定；当前没有生产实测，不能承诺停机分钟数。批准包固定总时限和查询超时，超时停后续步骤并保持已建立维护。回退只在本轮after与记录匹配时恢复原权限/HBA/配置，保留日志与部分备份；恢复调度和业务开放另批。

## 阶段二：兼容迁移与测试数据决定

同最终SHA完整迁移集合逐项checksum比对，以当前现场结果决定缺失项；不能沿用“171项”的历史结论。先在本窗口恢复副本执行完整向前迁移并验证运行角色、金额和关键回读；不做逆迁移。获准后正式迁移，失败保持API停用。

测试业务删除必须有准确对象清单、可恢复备份与所有者中文保留/删除决定；真实公司资料不能归零。需要数据覆盖恢复时同时恢复DB/附件一致快照，另行确认准确目标和影响。代码回退不能代替数据回退。

## 阶段三：同SHA维护部署

不能调用常规`deploy-production-server.sh`绕过其冻结拒绝。其原自动重启/迁移路径保持不变。

使用`controlled-runtime-exchange.mjs`执行纯运行文件替换：固定生产路径，只接受明确SHA、run名和四个before/after目录摘要；API及四项维护service/timer必须inactive，api.env必须root私有且冻结all。候选保存在`/srv/jiangkong/releases/<最终SHA>`并保持clean；已构建运行目录放在`/srv/jiangkong/stages/<最终SHA>`。这些路径只有最终版本获准后才创建。

工具不构建、不迁移、不检查或伪造备份、不启动服务；上游完整备份恢复、Schema及测试数据材料由批准阶段绑定。运行树摘要包含文件字节/权限及链接目标文字，不包含符号链接指向的外部依赖字节；因此独立版本目录和依赖必须固定并保留，禁止重用会被后续Git更新改变的`/opt/jiangkong/node_modules`链接。构建和依赖材料同时进入阶段批准包。

构建入口`prepare-controlled-runtime.sh`接收准确checkout、SHA和不存在的stage路径，要求clean及Node20/pnpm9；不联网安装、不读正式配置、不迁移、不启动服务。复制dist/prisma/assets及API scripts，保留指向独立版本依赖的链接。`verify-controlled-runtime-wiring.mjs`验证脱离源码的冷运行布局能加载冻结策略并返回503，不启动API或数据库；它不替代实际维护启动健康核验。

正常安装最多四次目录rename，各次后记录私有journal。运行目录与stage必须同一文件系统，否则在替换前停止。保留原api/web目录于本轮`.controlled-launch-*`下，任何阶段不删除旧目录。全部服务继续停止。

当前journal写入和目录操作未做fsync；本地验证覆盖正常与命令失败后的同机回退，不证明主机掉电后的崩溃耐久性。掉电后保持维护，先核对真实目录及外部保存的原材料/备份，不能仅依赖journal自动回退。完整DB/附件恢复材料须留在本机以外的获准私有备份位置。

完整安装后的准确回退接口为：`CONTROLLED_LAUNCH_CONFIRM=restore:<最终SHA>:<run> node controlled-runtime-exchange.mjs restore <run> <最终SHA> <journal摘要>`。这仅说明接口，不是含占位符的生产可执行批准单；正式批准单将填入全部真实值和脚本摘要。先比对原/现目录和journal；漂移或部分安装拒绝自动回退，保留两侧目录及步骤记录，人工核对实际位置后提交准确恢复命令。回退也不启动服务，不恢复旧调度、不开放业务，不恢复数据。

随后同阶段批准范围内仅启动冻结all的API，保持业务COS写控制及定时任务暂停，核验运行SHA、liveness/readiness、岗位权限、受控附件读取、只读页面及冻结拒绝。PG允许准确API连接后不能再声称全TCP拒绝；此处以应用冻结/任务暂停/实际身份限制及持续观察保障维护，记录例外。健康失败立即停API，不自动恢复旧业务运行。

## 阶段四：开放及持续观察

前三阶段材料同SHA连续闭合，另批解除冻结及恢复准确调度；旧02:30任务仍保留。不得把“文件已替换/API健康”当公司已开始使用。

实际岗位核对首批合同→结算审批归档→付款审批→分次实付凭证→余额历史。首批核对一个项目的结果，不在系统中限制其他真实项目功能。权限不变，super_admin不承担业务审批。发生金额/隔离/凭证问题停止相关业务入口，保存新增业务后再决定回退，不能覆盖上线后新记录。

日常先复用现有健康/备份监控；无变化不打扰所有者，有失败才汇报影响和需要的批准。不承诺AI会话持续在线，也不宣称尚未安装的自动任务已值守。版本变更、迁移、恢复、权限或开放仍批准；普通本地修复与窄门连续执行。

## 当前交付状态

这是已确认方式的本地实现与执行准备。真实生产备份/恢复、迁移、运行替换或开放均未在本批执行。最终SHA、现场before材料与实测时限未填齐前，不把本文件称为可直接执行的生产批准包。每阶段正式批准单必须给出准确命令/摘要、目标、最大步骤/总时限、影响、停止条件和符合after匹配的退出；一次批准覆盖列明的正常步骤和条件退出。

## 本地可执行入口（2026-10-13补齐）

- `controlled-maintenance-window.py`：capture/hold/observe，限定五单位和三Cron；禁新启动、停止timer/service、核对PID/cgroup、私有原件及派生快照。hold总120秒，capture/observe30秒；首个异常停止，部分hold不自动撤销。allow-api-preview仅创建本轮API启动例外，不启动服务；end-api-preview停止API并撤回例外。restore-controls要求完整held及准确journal摘要，恢复三条备份调度并删除本轮drop-in，服务/timer仍停止；该操作会恢复调度，必须明确批准，不能作为默认失败退出。
- `controlled-database-hold.py`：绑定机器/PG16数据库和OS计划，capture/hold/observe总120秒。只读备份角色先按完整角色预检核验；拒绝复制和普通外部连接、保留OS postgres peer和精确备份身份。最多32个准确PID/启动时间的在途连接一次终止；预备事务/订阅不自动处理。allow-runtime仅增加准确运行角色的本机SCRAM连接例外，API仍需单独启动且保持all冻结；end-runtime须先停API。restore-connections要求原件摘要，恢复原HBA会重新允许原数据库连接，必须单独明确批准，不能宣称它保持全部停写。root/OS postgres是获准恢复/迁移通道，不冒充被技术围栏锁死。
- `export-private-object-inventory.mjs`：固定私有备份连接摘要、同SHA clean及指定业务桶；30秒客户端/15秒只读SQL/2秒锁等待，全部状态同事务导出，最多10万条/32MiB。实际600文件fd读回、身份/摘要及fsync；零记录、缺摘要或超限停止，不做部分成功。空登记集与未登记对象的完整性须在现场另核，不能当成已无附件。
- `controlled-cos-hold-policy.mjs`：只生成业务桶已知主账号/应用/备份主体的拒写与程序身份管理拒绝，原策略保留；不改变备份桶，不禁止GetObject。COS资源uid使用APPID1438687719，principal使用UIN。未知写主体、ACL、生命周期/复制、在途上传及真实403/读取证明仍需现场取得；本地JSON不证明有效停写。官方依据：https://intl.cloud.tencent.com/zh/document/product/436/35854 。

### 历史只读批记录（下列“尚未”仅属于各批当时状态）

尚缺准确备份安装入口、当前helper ACL/对象创建者及当前迁移原材料，来自下一份有界只读脚本`controlled-launch-preflight.py`：一次既有SSH/root、三次只读元数据查询、五单位及准确三Cron解析/文件摘要；服务器60秒、客户端80秒，无配置/凭据正文、业务行、对象或生产写入。它不重新盘点CAM账号。生产未批准，尚未执行。脚本所得内部参数只进入本机700/600证据位置；之后据此填实安装及退出包，再集中申请固定提交和最终17门。

只读阶段执行器 `run-controlled-launch-preflight.mjs` 固定脚本摘要、一次SSH及全新证据目录；80秒客户端上限，未知stderr不保存。只读脚本不读取HBA/凭据正文，HBA完整before仅在另批正式停写私有快照阶段采集；不能将本次元数据取证称为已完成备份或停写。输出和收据实际fd/路径身份及读回摘要、私有属性与目录fsync均核验。阶段批准单与准确命令见本机证据目录 `production-readonly-gap-approval-v3.md`，尚未执行。

### 单次参数读取失败后的处理

2026-10-13已批准v3只读阶段实际exit1，安全partial不含失败阶段；无重试或后续生产动作。原脚本多列的第三配置文件检查现删除，安全诊断仅阶段/类别，不输出异常正文。三条实际SQL本地PG16通过不能确定旧现场失败根因。下一次只读访问必须按新v4摘要单独批准，原失败目录保留。

`prepare-controlled-launch-plans.mjs`只接受完整成功的只读原件，产生同最终SHA、机器/DB身份及三Cron原始摘要绑定的OS/DB计划；CLI要求clean候选，输入原件摘要/权限/身份核验，输出两原件与目录落地晚核。当前失败原件拒绝，未生成生产停写计划。计划生成不安装、不停服务、不证明停写；现场前置漂移仍由实际执行器拒绝。

2026-10-13获准v4第二次只读阶段在三Cron检查停止，未重试或修改生产。新入口严格识别脚本扩展名并排除flock锁/重定向日志，原命令摘要/允许根仍必须匹配；这一已证明解析缺陷不被称为现场唯一原因。失败只保存已完成的允许元数据和固定分类，状态保持stopped，计划生成器继续拒绝。v5单阶段批准包绑定最新脚本和一次SSH；读取范围不增，单位/两配置前移、Cron最后，避免后段异常丢失前段材料；尚未获准执行。


### 2026-10-13第五批收敛：真实缺口与先后顺序

获准v5只读批已执行一次，三Cron入口解析阶段失败并停止。安全partial保留已完成材料：171项迁移checksum均匹配候选172项，只缺模板快照迁移；备份角色和独立连接文件缺席；五单位inactive。它不是成功预检，不能直接喂入计划生成器，也不证明持续停写。私有原件、失败收据及精确缺项比较见本机证据目录；新生产读取只补三Cron入口与固定备份依赖，不重复SQL/单位盘点。

为消除“先要有备份角色才能停写、但创建角色前必须停写”的循环，顺序明确为：OS五单位/三调度hold→DB capture-bootstrap/hold-bootstrap→实际NOLOGIN备份权限事务→另批现场私有凭据安装/启用→完整原备份角色预检→enable-reader→正式完整DB/附件备份及隔离恢复。bootstrap没有任何备份TCP例外，不允许在这个状态宣称备份可用；OS postgres/root只用于列明的维护操作。正式HBA安装/排空及后续观察仍在同一获准窗口持续执行。

`controlled-backup-permission-sql.mjs`仅生成事务SQL，准确PG16数据库身份/helper owner及定义摘要、原NULL ACL、实际三个对象创建者均需匹配。新增备份身份NOLOGIN且没有成员关系、写权限或管理权限；完整原角色预检嵌入事务，失败回滚。现场凭据生成、私有连接安装和LOGIN尚不由此工具实施，不自动执行。撤回必须取得本批实际角色OID后生成，拒绝错误OID/权限漂移/额外成员关系；只撤本批读权限，不使用CASCADE。helper撤回恢复原有效PUBLIC EXECUTE，并撤显式runtime授权；原NULL ACL可能变为等效显式ACL，不能声称字节恢复。

两个后台任务仍绑定旧/opt脚本。`controlled-task-wiring.py install/restore`固定这两项、保持原批准参数/User，持有OS冻结时只将路径切到同SHA独立/srv运行树，不启动。新建缺席的两个/etc drop-in目录仅采用独占创建；journal记录实际文件/目录身份，撤回先匹配所有创建pin再晚核删除，只删除仍为空的自建目录，保留未知内容。部分安装/漂移不盲目撤回，保持维护并保留journal。总60秒，单命令15秒；接口要求准确计划摘要及撤回journal摘要，正式命令需最终SHA和完整OS计划，不伪填参数。

当前窄门：备份权限/恢复真实PG16 36项、连接围栏38项；任务工具7项真实本机文件系统回归及双审通过。任务工具尚未在真实Linux systemd安装，角色新LOGIN凭据流程及实际完整资金触发器生产回归仍需填齐；上述最小上下文测试不代替全资金领域验收。完整17门仍留最终候选，生产SQL/停写/安装/备份/迁移/开放均未执行。


后续“仅补备份入口”阶段已获准并一次成功，无生产修改。三Cron原命令摘要和两入口均匹配；实际安装目录/usr/local/lib/jiangkong-offsite-backup，缺db-backup-read-role.sql和private-libpq-service.mjs。旧/usr/local/bin/jiangkong-backup保持原摘要及02:30调度。已准备五文件安装草稿（run-production-db-backup.sh/db-backup.sh/严格SQL/private-libpq-service.mjs/cos-backup-transfer.mjs），真实before与草稿after逐项记录。草稿缺最终SHA、现场before原字节保存及安装/准确撤回journal，禁止直接安装；不含密钥或连接文件。原读取回执status=completed-readonly-backup-inputs，不改写v5失败status，也不拼成完整预检成功。后续OS计划生成需显式绑定两原件来源，或在获准写入阶段重新比较必要before条件，不能伪造完整passed原件。


## 第六批：私有连接、COS窗口与全附件恢复的实际入口

本批只有本地开发与验证。源文件摘要、窄门日志、冻结的下一阶段只读批准单见本机证据目录 `stage6-production-pack` 与 `stage6-local-closeout.json`；尚无修改后的提交SHA。所有命令接口仅描述参数契约，正式批准单必须由真实产物填满，不能把接口中的参数名称当可执行值。

### 私有备份连接安装与撤回

顺序固定为：OS五单位/三Cron hold → DB hold-bootstrap（无备份TCP例外）→ 准确NOLOGIN读权限事务 → 保存实际角色OID及同候选DB计划 → `controlled-backup-connection-cli.mjs install` → 原严格SQL读权限预检 → DB enable-reader。随机口令由现场root生成，SQL仅使用原生SCRAM verifier；口令只进 `/etc/jiangkong/db-backup-database.env` 独占0600文件，不进入参数、环境、输出或Git。root/OS postgres只作获准维护通道，不冒充被技术限制。

连接计划七字段为candidateSha/runId/machineIdentitySha256/database/databaseIdentitySha256/roleOid/dbPlanSha256。实际OID来自本次已成功的NOLOGIN事务；DB计划摘要来自同窗口产物，不能拿历史或猜测OID填入。安装确认值为 `install:` 加实际连接计划摘要；撤回确认值为 `withdraw:` 加同计划摘要、冒号和实际credential journal摘要。两种操作均通过原DB observe核验当前持续围栏，bootstrap/普通hold只按实际journal分支，runtime preview拒绝。

最大60秒、每个受控命令15秒；目标只有新备份角色和上述连接文件。异常立即停止并尝试准确角色NOLOGIN，不开启HBA或业务。若保护未确认，明确报告并保持其他围栏，不自动重试。正常撤回先核验实际文件及父目录创建pin、实际角色OID/DB身份，NOLOGIN并清空口令，再晚核删除本批自建文件；不删除角色、不撤其权限、不恢复PUBLIC ACL、不解冻。权限撤回是 `controlled-backup-permission-sql.mjs` 单列产物，不使用CASCADE。journal/未知文件保留，漂移拒绝盲删。

五文件备份入口现由 `controlled-backup-files-cli.mjs install/withdraw` 单独实施；与凭据CLI分离。准确目标仅 `/usr/local/lib/jiangkong-offsite-backup` 下原五文件，来源是同SHA clean `/srv/jiangkong/releases/` 候选的scripts/ops（Ubuntu所有），目标及journal是root私有。计划绑定candidateSha/runId/machineIdentitySha256/osPlanSha256及五文件before存在性/摘要/模式；安装前核验全部原件和源码，再在本轮700 state保存0600原字节及完整journal，每次替换前重新核对OS持续hold、版本clean和路径物理身份。每步fsync，失败保留before、stage与prepared journal，不重试或默认撤回部分安装。

正常完整撤回只接受准确installed journal摘要，先核对全部安装pin和before原件，再逐文件恢复原字节、uid/gid/mode或删除本批新增的两文件；最后观察后再次核对全部实际恢复结果和原缺席文件仍缺席，才记录restored。坐标/回调在await前固定，非默认组在新fd上恢复。最大60秒、受控命令15秒，最大五次文件替换；不更改凭据/COS/角色，不启动服务或恢复调度。接口确认值为install:计划摘要或withdraw:计划摘要:journal摘要；实际值来自最终SHA及本维护窗口，不伪填。现有 `backup-install-draft/manifest.json` 提供准确目标和历史before摘要，正式阶段必须重新比对；本机FS8项通过尚不等于Linux现场安装。

### COS持续停写与准确退出

`controlled-cos-window.mjs` 提供固定成都业务桶HTTPS传输和install/observe/withdraw；最多20请求、180秒、每请求10秒、每正文256KiB。安装前后比较六项原材料：policy/ACL/lifecycle/replication/versioning/uploads；活动生命周期/复制任务、在途上传或分页不完整均停止，不自动终止上传或删除内部规则。只允许一次策略PUT并核对实际结果，未知PUT结果保留原件/阶段信息，不重试或自动覆盖。

已知三主体为主账号100049377606、应用100050465776、备份100050728192；可另加独立匿名拒写。匿名`*`不涵盖其他CAM签名身份，不能标成全主体围栏。腾讯云保留主账号PUT BucketPolicy恢复能力，主账号是批准窗口内恢复通道，不能声称它也被封锁。其他实际写主体或临时令牌未闭合时禁止进入备份阶段。官方依据：https://intl.cloud.tencent.com/zh/document/product/436/45235 。

真实允许/拒绝证明使用每个已核验写身份：读一个已经确认的样本并比对内容摘要，再对本轮唯一前缀HEAD确认不存在，一次PUT仅以403且错误码AccessDenied计拒绝。认证失败、404、超时不能计作正确拒写。若PUT意外成功，只允许服务返回明确非null版本ID、同版本内容再核验后删除该准确版本一次；否则保留对象坐标并停止，不删除latest。探针身份、样本键/摘要与每个主体凭据来源必须由真实原材料绑定，当前没有云端拒写证据。

撤回只在完整after六项仍匹配时，PUT本轮原policy一次并核验原策略/其他控制；不恢复任务、不开放业务。漂移、未知版本或部分安装不盲目撤回，保留原件和准确RequestId。源材料七请求只读包成功也只意味着取到控制配置，不证明停写。

### 全部附件内容捕获与隔离恢复

原 `private-object-backup.mjs capture-and-verify` 新增 `--scope complete-bucket`，其余候选/私有配置/清单/输出确认契约保持。先由准确备份连接全状态导出FileObject登记，再列该业务桶全版本（无prefix）；捕获全部登记对象、未登记对象、旧版本及删除标记。XML严格解析并保留合法中文、实体及键首尾空格；目录恢复保留完整manifest，非普通文件/符号链接来源及既有目标拒绝。

上限500请求/600秒、100页/10万代、单对象128MiB、合计2GiB；清单前后不同、内容大小/摘要不符、缺登记摘要、其他桶、零登记集或超限即停，不能产出部分passed回执。超过这些边界是新的分批恢复契约选择，不能自动扩大。生产备份体积未知，不据此承诺停机时长。

隔离恢复只写全新私有目录，验证每份实际内容/摘要并保留版本和删除标记。它没有把历史版本重新上传成原正式COS版本ID，不能称为生产桶覆盖恢复。若要正式恢复，必须绑定DB与附件同窗口快照、实际受影响键及新版本映射，另批生产覆盖方案。捕获失败保留本轮部分目录；不触碰正式桶，不删旧备份，不伪造登记数据。

### 批准包缺参数的准确来源

| 参数/材料 | 来源 | 未完成时的行为 |
|---|---|---|
| 最终SHA、clean、完整17门、最终after源码摘要 | 收敛后获准固定提交和统一验收 | 不安装/发布 |
| 实际新备份OID、连接计划与journal | 正式NOLOGIN事务/连接安装同窗口实际输出 | 不以示例OID执行 |
| 五文件before字节、配置/HBA/Cron原件 | 获准维护阶段独占私有快照 | 摘要不足以自动恢复原文件 |
| COS六控制、身份及RequestId | 冻结的七请求只读取证阶段 | 不安装拒写策略 |
| 真实全部写主体、在途/内部任务状态、允许读/拒绝写证据 | 前述原材料与维护阶段真实有限探针 | 不宣称全COS持续停写 |
| 完整DB/附件量、dump/内容、独立恢复结果 | 正式备份恢复阶段实际产物 | 不做迁移/数据处理/开放 |

旧02:30调度始终保留。失败默认保留维护与证据；恢复三Cron、原HBA或业务写入属于明确退出批准范围，不能当无影响的自动回滚。运行文件回滚不替代数据恢复；上线后新增记录不得被旧快照覆盖。


## 2026-10-14 COS原材料读取与本地诊断

旧stage6只读批准包于本日获准后执行一次，第1STS请求返回非预期身份结构，状态stopped-readonly-cos-controls/reasonCode identity shape；未发六次COS请求，无生产修改。原件SHA256为6ec5bbcd0c66052962ef4da406e792f96e5d6ca7c1651835d2712a6e9f6e20f2，失败收据和partial保存于 `/private/tmp/jgzg-controlled-preflight-20261013-cos-control-inputs`；不重试、不换身份或扩权。

本地发现请求漏官方Region头，且未区分HTTP200中的云Error；增加固定ap-chengdu头和安全分类/RequestId，云Message与未知身份字段名称/值均不保存。成功六字段及实际身份坐标保持严格。官方契约 https://cloud.tencent.com/document/api/1312/66098 。7项无网络回归通过，但旧真实响应没有留全文，不能据此宣布本次原因就是MissingParameter或权限失败。

新冻结来源SHA8774ad0b68481c7a0c3b3e7c378ba66fa4c2200dd1b941e5e8258f64e139332d，执行器8b7b7d8f2eb2cd4b5b1396e0e4affd2671ae28fe17bb5eda1f493dad6eec3d97，准确批准单SHA0a3ec2814a7a48eaf67bdf1f6722cf11b92687f7c68af408222524c877291995（`stage8-production-pack/production-cos-readonly-approval.md`）。新输出目录为 `/private/tmp/jgzg-controlled-preflight-20261014-cos-control-inputs`。一次SSH/最多七官方只读请求、75/80秒、影响和停止/退出与原范围一致，不重复DB或服务盘点。旧许可不覆盖新执行；当前未访问该新阶段，不触发安装/备份或开放。


## 后续COS读取真实结果及替代提案

2026-10-14 stage8获准后执行一次：STS六字段归属精确匹配，第2请求业务桶GetBucketPolicy返回403 AccessDenied，立即停止，余5配置未读。机器与初始配置摘要、已校验身份及COS请求ID/响应摘要只在私有partial保存；完整后置配置比较没有运行，不当完整成功预检。原件SHA aad84f967e5102c76dfa38d2e04cb9370d6c9e472605ad294f6e90feb947e91b。失败收据及身份独立投影位于 `/private/tmp/jgzg-controlled-preflight-20261014-cos-control-inputs`；后者明确来自stopped阶段，不改写全轮状态。

不重复应用身份请求、不扩权。待所有者确认的替代为主账号既有工作台人工核对COS管理配置，仅受控首发，来源标owner-console-observation；自动COS工具/API快照/原签名协议不放宽，页面材料不得伪造API XML喂入原工具。策略变更/恢复将另列准确before/after工作台阶段；真实写身份403/允许读、持续控制与完整一致恢复要求保留，页面无法提供完整材料就停止，不能用人工模式跳过。

离线 `prepare-controlled-cos-console-read.mjs` 严格消费实际两请求失败原件，拒绝重复键/非规范输入、错误身份或非403证明，只生成proposal而非收据、权限或执行授权。已从实际原件生成固定owner/bucket/六页面/600秒准备产物；5项反例通过。批准单 `/private/tmp/jgzg-controlled-first-launch-evidence-20261013/stage9-owner-console-read-approval.md` SHA3f746a85ac78de6c1a27d7bd089d1b02364be9d1f4d91ffa67e530e1d1207a4f。尚未打开工作台或访问新阶段；身份/完整性/敏感字段/工具异常立即停止，无生产变更/配置回滚，仅安全保留partial及本轮标签条件退出。


### 主账号工作台阶段一次执行结果

2026-10-14所有者已采用人工观察替代并批准stage9准确范围。浏览器库存只见旧CAM未提交标签，未覆盖或导航该标签；创建本轮官方COS标签357742139时导航超时，按首个异常停止。当前owner/bucket及六配置均未确认，没有输入或提交生产表单，不刷新/重试/改用别的管理渠道。导航可能已产生只读访问日志但页面结果未知；未知新标签保留，不能把它写成成功读取或当前登录确认。安全partial位于 `/private/tmp/jgzg-controlled-first-launch-evidence-20261013/stage10-owner-console-partial/receipt.json`，原批准包字节保留。

该结果是浏览器通道异常，不证明云权限失败或服务器故障。当时已按首次异常停止结束；后续所有者确认只读导航超时可核对同一标签实际结果，身份、权限异常及生产写失败仍停止。该改变不扩大生产写入或凭据访问。原标签357742139已不在当前库存，旧CAM表单保持，等待所有者打开工作台后继续已批准六配置只读观察；无需重复选择人工方式，不复用历史身份，实施时间与页面/登录等待分别记录。

## 候选冻结前收敛（2026-10-14）

GitHub main重新读取仍为1a50aca84035c13a6df49a58337f6ea5e6a2c5ca，独立仓库缺失的origin/main引用已fetch补齐，为HEAD祖先；没有重置或清理用户根目录。当前#122/#123/#124仍OPEN，#296历史CLOSED不替代本窗口兼容收据。Issue正文及main比较源清单保存在本机stage11证据。

全候选聚合双审发现并消除root读取Ubuntu候选的Git所有权拒绝问题。运行交换入口复用既有canonical、单命令safe.directory、禁fsmonitor、精确SHA/tracked/clean校验，不改全局Git配置。CLI虚拟root接线反例、原运行树/附件共17项、编排287项、类型/lint通过；VM不证明Linux现场运行。

固定提交与一次最终完整17门仍集中申请，可绑定精确源清单及父HEAD；提交后读取实际新SHA，全部完整收据绑定该SHA，不继承旧票或拼轮。新代码使旧完整验收失效，首次失败停止并保存证据。不将本地提交或通过当作推送、合并、生产备份恢复、迁移、部署或开放授权。

## COS实际观察后的收敛（2026-10-14）

stage12准确批准单SHA1e121f61bed38e636d3c4fa4997d984b84312cbd65d3d3445aee1a443440e661已执行六项只读核验，原件位于本机证据目录stage12-owner-console-observations。主账号100049377606、ap-chengdu业务桶身份匹配；策略JSON只读页显示{}，ACL私有读写且只见owner完整控制，版本开启，复制无规则，在途上传一页为空。不能把{}转换成虚构API原文，也不能把一页为空写成持续排空。

唯一显示的生命周期RegularlyClean_HistoricalVersions_1784102512113覆盖全桶且开启：90天后删除历史版本，并清理没有历史版本的删除标记。此内部删除来源必须在获准维护阶段准确暂停，保留规则，不删除、不暂停版本控制。暂停后仍须核对前后完整版本清单与内容，不能凭开关推断排队任务已排空；变化或遗漏停止备份闭环，保留partial。恢复规则另列在明确退出批准中，不默认失败恢复。

关联权限页可见应用仅uploads读写、旧临时备份只允许少量指定对象读取；这些观察不是完整CAM有效权限证明。现有独立备份身份100050728192需要现场STS重新核验与整桶版本/内容真实读取证明。建议仅在该业务桶临时增加GetBucketObjectVersions/GetObject/HeadObject及六项配置观察读取，保留备份桶既有权限、不新增密钥、不增加应用管理权。九项只读策略是待所有者确认的权限变化，不是已安装配置。

本机stage13-cos-window-proposal提供准确策略JSON及变更/撤回边界。此处只形成方案，未执行生产权限变更。新增只读条款和维护拒写条款分开：备份只读先验证，维护拒写须在OS/DB持续hold后安装；恢复读取授权时只撤本轮条款，不顺带解除拒写或恢复生命周期。页面after或关联漂移则拒绝自动覆盖，保留原件和当前维护。

实际全写源仍按受控首发范围核对：已知应用/备份、主账号批准维护通道及内部生命周期；匿名拒绝不能覆盖其他签名身份。窗口内所有者不进行其他控制台写入或允许外部客户端写入，但该操作约定本身不是技术证明。无法排除的有效写来源需明确处理，不能靠本次只读页面自动闭合。

## 已确认备份读取方案的接线（2026-10-14）

所有者已确认九项只读方案；确认仅涵盖本地适配，不安装生产权限。`controlled-cos-preflight.py backup-reader`仅从既有root私有`/etc/jiangkong/db-backup.env`取备份凭据，在内存选择固定成都业务桶，原备份桶及配置不改。先STS精确核对100050728192，再最多六项控制读取，75秒/七请求，原件保存精确配置摘要；末尾比较同文件物理身份/摘要。无参数时原应用模式及错误停止规则保留。

backup-reader明确接受且保留NoSuchBucketPolicy、NoSuchLifecycleConfiguration、NoSuchReplicationConfiguration的真实HTTP404/Error原文；身份错误、AccessDenied、未知404或敏感内容仍停止。缺配置不是合成200/XML，也不代表停写；该结构用于这次人工受控核验，不能作为原自动COS窗口工具要求的正常XML传入。窗口实时核对原响应、准确策略与生命周期/在途状态，任何新实际写源仍需处理。

完整附件入口增加`--storage-profile existing-backup-reader --storage-env-sha256`，摘要必须来自该身份只读取证同一配置原件，路径只允许`/etc/jiangkong/db-backup.env`，同时必须`--scope complete-bucket`；不允许默默回退应用连接。新profile拒绝未知配置/临时令牌、错误备份桶或地域、非root私有文件、链接/多硬链接、超限或配置漂移；通过完整捕获与独立目录恢复后，再核对源pin和摘要，之后才生成原回执。既有默认存储入口不变。

新增`backup-reader identity-only`只执行一次STS及同源末尾校验，成功才允许下一步准备生产读取授权；不会在授权前尝试其他COS管理读取。正常backup-reader仍为七请求。两个固定SSH执行器已在本机执行包中准备并通过4项无网络接线/私有证据回归，现场尚未执行。

最终可执行命令要在获准固定提交后用实际新SHA与本窗口配置摘要、登记清单及新目录渲染，不能把本文接口参数当已填齐的生产命令。Linux实际源文件、真实云允许/拒绝及生产恢复均未在本地测试证明。当前新增10项只读回归、17项附件/COS、编排288项及全仓类型/lint通过；新SHA完整17门留最终候选一次运行。
