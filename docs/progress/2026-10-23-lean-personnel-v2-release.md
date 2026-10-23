# 精简人事V2上线权限补修与发布记录

本批于北京时间2026-10-24 00:23:22（UTC 2026-10-23 16:23:22.504481）完成技术开放，准确生产运行版本为`733c9bae916001c3436f6110a9a4b2e0ae04e175`。server观察及Mac独立外部验证通过；真实员工业务未代办，#348历史根因阻断保持。阶段失败、恢复、权限与开放证据如下。

## 当前授权与边界

用户于2026-10-23明确授权本批合并并部署。PR #370候选46e87c1037f0ffec49fbb5a9ac1d488536d2c095的26项CI全部成功，已按准确头约束squash合并为816612d4a1f746edd228fbbfc73a4d64ae52757f。上线权限补修PR #372候选959d30512a4ef3214fb73b26b1e6941a8cafc4c2再次取得26项CI全部成功、workflow终态completed/success后，按准确头约束合并为最终M2 `733c9bae916001c3436f6110a9a4b2e0ae04e175`。两次合并树均与对应候选完全一致。

共享根未改，本轮不执行归零、合并人员、日期回填或真实审批。部署成功不等于真实员工操作验收，也不解除#348历史故障根因阻断。本记录只公开技术结果、数量与本轮私有收据摘要，不复制秘密、配置正文、原SQL或业务行。后续仅文档收口PR；文档分支或提交不是生产运行版本，不替代M2的准确SHA资格，也不据此重部署。

## 生产前置核验发现的权限缺口

本轮可信只读预检确认生产PG16已有195项成功迁移，待新增两项人事迁移。创建者`jiangkong`的默认表授权给`jiangkong_runtime`为`arwd`，备份角色仅`r`。V2授权文件原先只执行GRANT；对已有默认表级UPDATE/DELETE授权再授列UPDATE，不能收窄有效权限。

本机`network=none`的一次性PG16，以准确816612d4的两迁移和原授权文件、真实owner/默认ACL构造最小夹具，得到`PersonnelChange`仍有UPDATE/DELETE、`EmploymentPeriod`仍有表级UPDATE/DELETE，且id/userId/createdAt可UPDATE。拒绝断言真实退出3。该结果是权限根因证明，不声称已绕过历史保护触发器或修改生产记录。

补修仅收紧被明确配置的运行角色在两张新表上的授权；保留追加事实所需INSERT/SELECT/序列权限及任职期间必要列UPDATE，保持备份角色、旧三表、其他角色、默认授权与既有迁移checksum不动。无法由该运行角色的直接撤权消除的PUBLIC/继承危险权限应失败关闭，不擅自改动全局角色图。

独立审查继续真实重现了两条PG16身份路径：NOINHERIT但SET TRUE的成员可切换到历史表writer；SET FALSE但ADMIN TRUE的成员可先自行再授SET再切换。两者都不能只靠当前身份的has_*_privilege检查排除。补修检查可切换身份及角色管理通道，保留SET FALSE且无ADMIN的安全正对照；取得最终复审后才放行。上线前只读元数据当时显示运行角色的SET可达集合仅自身，但该事实不能代替通用脚本的拒绝守卫。

最终实现对每个运行／SET可达身份按USAGE检查可继承ADMIN，覆盖先SET再继承的组合链，并拒绝服务器程序执行与文件写能力；全部真实危险反例退出3，完全不可达管理链、只读可切换身份正常放行且他角色原授权保持。最终授权SQL摘要为`b7681768a2539665c887a2845b50baaa0d76c38c606220ba4ecb5478e4584860`，独立规范轴与规格轴复审各0项。原59项及编排、受影响类型/lint按冻结实现重验，后续准确M2的完整17门也再次运行这些受影响正反例。

## 最终M2的准确发布资格

816612d4的本机完整门禁在首8门通过、进入第9门后由主控有序停止；退出143，未产生成功收据。该版本不作为已通过17门的发布版本。补修后的审查、完整CI及新合并SHA的17门均须重新取得，不能沿用旧资格。

最终M2主线[CI39958036475](https://github.com/1131096740/intelligent-construction-management/actions/runs/39958036475)已终态completed/success，26/26检查成功。准确M2的全新干净worktree使用Node20.20.2、pnpm9.15.9，经冻结安装、Prisma生成及预检后，从首门唯一完整执行17项，原工具自然退出0。17个固定阶段与逐阶段耗时均齐全，22组真实PG16全部运行；受影响六套PG/HTTP59/59与三组桌面/手机共6/6场景通过。API8369项通过、539项条件跳过不计通过，Web2217项与shared-domain247项通过；末段P0浏览器3项、RC06模拟浏览器28项通过。未调预算、断言或重试，也未复用旧SHA资格。

原工具成功收据为`local-release-733c9bae.json`，schemaVersion=2、status=passed，绑定上述40位M2。原`local-release-receipt.mjs --validate`使用同SHA自然退出0；门后HEAD准确，`git status --porcelain`为空。公开核对摘要如下，原收据、逐阶段耗时、浏览器/数据库附件及私有日志留在本轮受控交付包，不复制原始SQL、角色设置、备份内容或认证资料。

| 证据 | SHA256／结果 |
| --- | --- |
| 原17门成功收据 | `3df7589746d1551fbf5ce94e0da6dd3b225441a28351702fad3a149702ca036e` |
| 原完整门禁日志 | `7598f0ab4b65db1bc6bc0ac82204e37ec7f3fae1fc514bd904c6af6fa6cfc220` |
| 17阶段耗时合计 | 2,605,233毫秒 |
| 准确SHA的PG16阶段 | 22组全部完成，2,018,663毫秒 |
| 原收据校验、准确HEAD与干净状态 | 全部通过 |

## 本轮备份与隔离恢复证据

本轮独立全备已成功，异地实际GET取回与本地摘要一致；全备SHA256为`f783f970a260f195cbc6ffe02ffd46e7d56a61509d064b16d68bf6c5b7ca3dca`。该证据仅证明导出时点的恢复点，不能代替切换前的新鲜度核对或准确候选迁移后的权限、历史数据校验。

该新全备已在本机无网络、无宿主挂载的PG16两独立空库真实恢复：298表、1497行，逐表计数与排序行SHA256聚合一致；195项成功迁移与本仓库对应checksum全部匹配。此次使用`--no-owner --no-acl`，只证明数据恢复完整性，不能冒称保留生产owner/ACL或已完成最终197项迁移、运行角色与应用兼容验证。首次只读摘要辅助SQL的引号错误已保留，修正后重算，无数据变化。

随后另建network=none、无发布端口/宿主挂载的PG16，以唯一合成管理员初始化，原样恢复本轮无password角色备份；另两独立空库各恢复带owner/ACL的实时schema归档及原全备data-only。数据阶段只在隔离副本使用disable-triggers；未排除表、跳过角色或ACL。角色回读仅排除合成管理员自身的两条声明后，与源角色SQL逐行一致。数据库owner及完整ACL按主控本轮只读元数据还原，保留PUBLIC原TEMP/CONNECT，未附加权限；再导出schema的owner/ACL仍与归档一致。9条纯GRANT默认权限语句只有导出排列顺序不同，语句精确多重集合相同，其他全部可执行SQL逐行一致；没有忽略触发器或权限语义。

四份数据副本的298表、1497行及逐表摘要全部一致，聚合SHA256为`e7c6d95f7b8b11649c481ee49bcec09b59e5528ef57a6f8ad153d94f62ae7e2c`。195项成功迁移集合及checksum无漂移；两次不同导出快照去owner/ACL后的结构SQL也完全一致。元数据schema归档SHA256为`1a8326da82f7e2290c35b19e3d8232d885ae66502a7b2893a24f0549d4170503`，无password角色备份SHA256为`339bad880fbab54e057c51d170076e509bf3b83d3e9b8ba25f03b3aee18d2fa6`。归档头的时区文字按原样保存；Mac文件birthtime/mtime只标为本地传输边界，不冒称服务器精确查询时点。此阶段只证明195项源数据及owner/ACL恢复，不构成最终197项迁移、运行权限或生产上线验收。

## 私有运维附件的真实失败与补证

本轮独立规范审查用纯合成归档重现：TOC标为public schema不代表该条目一定执行CREATE。私有恢复附件已改为提取准确条目的DDL再分类；显式CREATE与仅owner两种夹具的行、序列、owner/ACL和默认权限均验证保留。实际reader全备和另采owner/ACL归档的public schema条目均为0，必须保留initdb已有public，不能按标签误删再期望归档重建。两种合成正反例和实际条目提取证据均为本地隔离操作，未连接生产。

实际两份归档再在network=none的新PG16做schema-only恢复，298个relation、323个function、6条default ACL及列ACL等元数据对齐。首次完整比较中，两边均有3901条trigger，却因内部RI触发器名称含重分配OID而报差异；原差异保留。补修仅对内部名称采用稳定语义，完整保留3408条内部和493条用户trigger记录，最终owner/ACL与全部trigger语义对齐；停用或重命名用户trigger的反例仍被检出，恢复原状态后重新相等。这些是schema-only恢复与合成反例，未恢复业务数据，不能代替前节四次完整数据恢复或生产迁移证明。

归档/trigger阶段的私有附件以SHA256前缀标识：companion `1e5208d5`、entry `96309cc6`、当时cutover shell `e70a2b56`／Python `c0a5c712`；该阶段规范与规格独立复审各0。后续clone隔离补修后的最终五文件摘要另见下节，不能沿用旧附件标识。附件不改M2源码，原SQL、详细角色配置、归档与日志保持私有。本草案仅登记准备与验证结果，不把安装附件或发起prepare写成实际切换成功。

## 原prepare的闭包失败与隔离诊断

原prepare会话末尾标识`ra82eMaA`的source fetch已自然完成；四组件的before/copy/after完整清单均为0差异。随后原strict closure因唯一既存`fflate@0.8.3`孤儿停止，原失败现场保留。清单复制一致与依赖闭包完整是两项不同结论，不能把前者写成原始全闭包通过，也不能把本次停止描述成中止Git fetch。

原运行目录中的`node_modules/.pnpm/node_modules/fflate`指向`../fflate@0.8.3/node_modules/fflate`，源和副本的该目标均实际缺失；原根锁文件及installed `.pnpm/lock.yaml`均无fflate。对43,030份代码文件、1,067份package manifest的只读检查均为0条fflate声明、0处源码引用。该证据用于界定依赖残留，不能代替恢复或原生模块运行验证；没有删除旧链接、旧源码或修改原依赖图。

后续仅在新私有helper中分别验证两条路径：其一按原state逐字还原全部内容并保持孤儿，用完整清单证明恢复0差异及真实旧native模块可导入；其二另派生runtimegraph，只在隔离副本移出该无声明残留，再执行原strict closure。两条路径均已实际通过，旧/新native在隔离netns、无DB连接、不实例化Nest应用条件下通过。原strict失败仍保留，`originalStrictClosurePassed=false`，未追改为原始全闭包通过，也未更改原源码或孤儿链接。备用bundle已安装但未使用；拟发送SIGTERM前的phase guard发现direct已完成，因此没有发信号，也没有rename。

resume prepare会话`ooH0CyeR`于2026-10-23 15:02:30.547841 UTC取得`prepared`终态，result SHA256为`c49e6bff33cc21085d56d6aa18a5f6fd983a10191d3fd3cbc61e43ee70b57026`；legacy qualification SHA256为`0e9d28feecf61762c84619030c956fb7cb47a58de5e2389116a338feda09f331`。该结果仅为prepare完成，明确未停写、停服、迁移、替换运行时、开放或写生产业务。

## server完整封存与异机交付边界

同锁私有pack会话`vOgtObzb`已实际通过，两次prepare run的before/after完整清单均为0差异；源与全部物理副本在server保留。完整包为2,533,506,051字节，SHA256 `32cb52eac7df7dc6e8b25b5abda4758207a4aefb58fbece54097cb4273385b63`，result SHA256 `cb9baaebc731e43347721ff4a04913944942ea475692def23c4afc1a36d1353d`。此项是server封存成功，不是完整包已异机保存或生产部署。

本轮实测出站约0.551MiB/s，异机交付改为可完整恢复的artifact set：完整literal原state归档313,221,447字节，SHA256 `698e2b3c6ddca16dda6d5019728d5b0f99a6885e17a52b074568eb8fec717706`；完整derived strict graph归档313,072,143字节，SHA256 `5d5492f33a99481f0102bae27d4f561e5451e8d700c47b450e404057354cb136`；另附全部执行proof元数据的小包。元数据小包仅精确省略已由两份完整归档表示的5棵重复实体树，以及两payload和server完整包的重复字节，须保留省略清单与对应恢复映射。

后续两payload的本机传输命令均已exit0，准确大小与SHA如上；该退出码不单独替代下载实校和完整集合验证。metadata producer会话`n7FjvVzm`自然exit0，result SHA256为`6ffcd3f3d482c0ceaec3f04bbdbc9cb591b1476e1ee8606bb97485d80c9f24a7`；metadata归档142,419,789字节，SHA256 `6748779b3fd409cdad5f02abd45f790ea4f0dec24eb0e59f4da576ddeba1db5b`。三件均已完成异机接收与完整内容header核验。

异机完整artifact set于2026-10-23 15:54:53.918376 UTC取得`passed`收据，SHA256 `b2abe06a2085b245efc75b93461b62f9d0290afaea55852e082517381eeec9c8`；metadata本地核验收据SHA256 `02c6a7c6b95a6ff12eac08e8444e48a326542bb09a55a597b35e0977805889b3`。Mac核验原样76,571条与派生76,570条的全部内容、类型、mode、uid/gid和link，每包实际逐字节hash的常规文件payload均为952,434,993字节，gzip/TAR尾完整；metadata184条也完整验证。归档内权限/属主是按header核验，Mac没有物化文件系统恢复或应用这些Linux权限/属主。Linux此前的实际恢复/native资格以所收准确原收据另证。

本项只签认三件完整可恢复集合异机通过，不签认2.53GB完整物理包或全部F/N物理副本已offhost；后者仍留server。完整server包、两payload、原strict失败和全部原副本均保留。本轮保留原运行内容和链接的证据不解除#348历史故障根因阻断。

## clone隔离P1与最终私有运维附件

本轮发现隔离恢复库仍可被owner的本机peer通道连接，不能仅靠业务入口或运行角色连接限制证明clone隔离。私有工具补齐恢复库的`ALLOW_CONNECTIONS=false`关闭及开放前重验；只允许准确登记的三副本身份，重验OID、关闭状态与活动连接，失败不擅自修复目标。PG16.15 network=none合成测试先证明运行角色原可连接，再关闭三库并重复拒绝peer连接，且行、owner/ACL、全局角色及名为生产库的合成负对照保持。重新开放、同名新OID、未知生产目标、活动backend和proof漂移五项反例均被检出，未顺带关闭或修复反例目标。最终静态Python AST/bash语法检查与独立审查通过（未解决项0），应用候选M2未改。

本轮实际owner peer只读guard的result SHA256为`e2d2f1fc14f692f67bc828b038bcbf6d8d749563a2e36291b4ed7a47e2626da8`，其事务已回滚，未使用password或执行迁移；不能以该只读结果替代后续clone关闭或maintenance生产执行。clone隔离P1阶段的v2五文件已安装，摘要如下；clone P1的正反例及安装资格均不代表生产步骤完成，后续v3版本另列。

| 私有附件 | 最终SHA256 |
| --- | --- |
| restore qualification | `7889ac729dbf8a687accaefb4dfa7df283176fb990a0e00e3140c2886ed4ccc7` |
| maintenance shell | `d42d942c88b99f90ddbbd9f6061d786ba7ba75b11a4106fc9c4ff25d8612716b` |
| cutover Python | `f94487ff853c411fa005a37ea0ea2473da4798c40ec92f182c8a3edbbcdb346e` |
| cutover shell | `bf4ef63fca930e8345c79c0d701abc396532aa807e4ca1a46d89d733fe7462ac` |
| owner peer readonly guard | `8cba4eed6a5ea6c89c69165aa467ac9602b86ab74c6f874475aeb2306d383e72` |

## 原maintenance真实失败与v3修复资格

原maintenance `gyHUd8sU`在`actual-two-restores-candidate-migration-and-reader-third-restore`阶段真实失败，result SHA256为`1062865057788e99b9200938d01d9fd87932c3a78a4f9a885025e8b69fdaa416`。该失败时API/Nginx inactive、OS/DB held、all freeze，生产仍195项、未做生产迁移或运行时exchange。原失败阶段完整异机capture标识`maintenance.a723owej`，6,140,826字节，SHA256 `6bf8744725ebc7b6081d1da8c02bd5b6cc1f03cc1015f75abd81be3ba8459633`；原v2包、失败run及其副本保留，不改写失败结果，也不重启旧API绕过门禁。

真实根因为trusted extension还原中的成员owner与扩展owner并非同一概念：pgcrypto36个函数在原restore后owner为postgres，源为jiangkong，元数据精确比较因此拒绝。修复只依据已捕获的准确源成员owner/ACL对隔离恢复副本还原，不把扩展owner当作全部成员owner，也不改生产扩展或全局角色。PG16 network=none夹具先重现全部36项差异，再验证3个独立修正副本完整保留源owner/ACL、特殊owner、定制函数ACL及表/列/default ACL；9项未知源反例全部拒绝。错成员在ALTER前零写、错误failed pin拒绝也通过，原失败保留。

新helper另实测四库metadata closure与四次实际peer连接拒绝、只读重验；重开保留的失败副本会被检出，没有drop数据库、终止backend或接触生产。两项合成proof分别为`333fe85d7717740c3eba36904ed8203d20b118d48975994ea1a9bedb0f8c978d`及`7e506efdb33924be88713906c6da3f3c82d3004fda6d1448770ae1f9cc749f40`，均绑定同一已冻结v3 helper，规范独审未解决项0。此项是私有工具修复资格，不等同于新一轮生产恢复资格已完成。

resumer沿用原准确M2、原失败收据、原api.env.before摘要及原units/held配置，不重新capture/hold、不把已停控件当原状态重采，不重复启动旧API。独立审查发现通用observe同时接受preview/runtime allowance，已在每对observe前后严格要求OS `os-sources-held`、DB `connections-held`、bootstrap exact false与准确数据库；OS journal采用原工具canonical plan摘要，DB保持原文件pin。异常仅失败关闭，不自动撤preview或改HBA。resumer执行前主控只读确认当时正处该严格held状态。语法/嵌入Python解析与最终增量复审通过，M2应用代码未改。

| v3已冻结附件 | SHA256 |
| --- | --- |
| restore qualification helper | `b741f52ba400de1521c4e48fe62874c36fa4a014005057b925bbb54e2504352d` |
| maintenance resumer（已填上述准确helper pin） | `babebf30538c42dbb24da4a4e00d91bc0f1b04f60f091659e9d28425ec5b2bc7` |

新的root0700 v3 packet四文件已独占安装并校验，原v2及failed run未改。resumer按六个准确参数执行，实际自然终态见下节；资格来自本轮真实执行收据，不能由本地合成回归、安装或发起命令替代。

## v3 maintenance与受限preview的真实终态

v3 maintenance会话`9d1hTufx`自然退出0，状态`precutover-qualified-production-not-migrated`，result SHA256 `5f306f8c7df079b614cb18481cf8c4927300a3f249695a60b7b9c0025c0d4157`，restore qualification SHA256 `56a7d8daa9aff77ea877d5a7955d5c322983a5d6a67330d635e4af798fe6a8f1`。新鲜全备`jiangkong-20261024-001246.dump`为3,060,099字节，SHA256 `42b7cf77c777ff94034b24312ff0a6f9ee64459ace047f01f02abba85d14899c`，真实COS GET收据SHA256 `081af111e5656aece9ef0f2e48b347c687853a32719f69d83ba9a8f7a1ce5a09`。日期文件名不替代实际时点；本轮安全摘要于2026-10-23 16:16:41.403627 UTC登记。

本轮两次raw生产恢复、两副本197项候选迁移、reader导出后的第三次实际恢复及完整正式运行授权/验证链全部通过，源扩展与准确成员owner/ACL保留，全局角色及成员关系未变。297张保护业务表、1302行的旧行hash保持，保护摘要收据SHA256 `486008afe1010eee885ef3bd739140ac67935b0c45a65e25f20d0f102d04a632`。4个保留副本全部关闭连接，4次实际peer连接拒绝；closure proof SHA256 `1ddce0e7b11b7e5b53195060fb10dff0205208839dbca02e402c61d110354fa8`。其中原失败副本仅保留并关闭，不被改写为qualified。maintenance整体异机归档8,097,282字节，SHA256 `a6adda4df041a30eabb169a7f1102564b868e972c19398b80ab727f1f56467ef`；其安全摘要SHA256 `c611dc5329d7e2f2ff8ccab4cecfda1ee186cf9d735e9851ce57bb9fbc8c4a6d`。该阶段仍未生产迁移/切换/开放。

随后preview会话`6fyafrtp`自然退出0，状态`preview-qualified`，result SHA256 `bf9b1f23d15bcf3532018c187d6331538fc59ee3f9168b2151e3b411659871de`。生产已完成197项向前迁移及运行包exchange，实际新API身份绑定准确M2，配置与进程有效freeze一致；preview当时公网仍closed、all freeze。全部197个迁移名/checksum已再次与M2逐源文件核对0差异；终端仍为`20261023100000_personnel_lifecycle`，checksum `3728120258fd924b194e8614760e5eac8d78c5c38c11b6ca6373c43c4945c662`。原195项迁移事实和297表1302既有行在新API启动后保持，两张新人员表为空，未创建或修改员工。

受限新API匿名读取401、维护态写探针503拒绝，未进行生产业务写入。实际运行包收据SHA256 `7b66ffcd3e72c8b3eee8014598f51a13c81698dfc5f855620e1b9d4d3d282550`，Web资源收据SHA256 `98274ea9a802be1c87ac27191d7f573c5232d19173067a8b087cfac5a5b291ee`。生产197项后的全量备份3,073,615字节，SHA256 `44a08b1ddaa1ca5c9115ca24a39cc3409287d76baf5541108f7a9a93c3d7554c`，真实production reader取备份与实际COS GET所得SHA一致；不复制凭据路径或值。

preview整体异机归档5,743,613字节，SHA256 `d95f115e0c6456946af460d2aaac0fe46dfac3d6af035d634c3b0c592dc4b5e7`，已完整校验；preview安全摘要SHA256 `3ddb122e3942805331eb7d5745ef60387da759eec18b83b01e3e2dcbd841a0da`。摘要登记时点为2026-10-23 16:19:09.684867 UTC。上述证明生产已迁移并受限运行M2，不构成开放或真实员工业务验收。

## 2026-10-24开放与独立客户端终态

open会话`qgdo5cts`自然退出0，状态`opened-and-verified`，结束时点2026-10-23 16:23:22.504481 UTC，即北京时间2026-10-24 00:23:22。原result SHA256为`edac13dc5af895e360baf08c7bc438ddc562b83f041694776df765b76262b0d2`，本轮安全汇总SHA256为`afac66f3b3a7d471662c56ef635d24e4733ab039934ad4c50fcb1781a8a9d581`。

开放前最后冻结数据证明SHA256 `8cdabe7614339b76ba33f18ad435a00ee252edd5d0c1ea9a9f1ce9a109ecd826`：准确M2、197项迁移，配置与有效all freeze一致，Nginx与原定时器仍停，保护旧行hash不变、两张新人员表为空。解冻后没有读取或比较当前业务行，也未回滚合法用户写入；“新表为空/历史hash不变”只绑定上述冻结快照，不冒称开放后人员业务仍零变化。

server在production-host公共origin做12个样本、303.7628375068307秒观察，84项通过、0失败、0跳过，并额外确认HR匿名401；公共证明SHA256 `4057ae1d3777a0fd978802374fff9e189b0f742718103241b592c56aa93fac37`。该观察来自生产主机，不当作独立外部客户端证据。另由Mac独立完成3个样本、18个只读GET：严格系统CA与hostname校验，不经proxy、不跟随redirect，index及两个entry assets的hash全部匹配，HR匿名401，证明SHA256 `e0fa59bc2bb79e37ca3548f69456bb41f9e10ce8010724e081f0d9abd76ec656`。未登录代办入离职、返聘、调动、授岗或审批，真实员工业务仍未执行验收。

开放后只读guard通过，result SHA256 `9b789c578cca701daba3691292393717f013509a47e8255671476d4b67c1c405`。该核对时API实际PID1841180，进程cwd/entry/new modules均绑定准确M2，运行角色为jiangkong_runtime，仅监听127.0.0.1:3000；配置与有效freeze均off，非freeze配置原字节一致、原HBA原字节恢复。197项checksum全部匹配，四个保留副本再次全部closed并实际peer拒绝。API/Nginx active，draft-retention timer恢复active，purge timer原本inactive并保持inactive，两oneshot inactive且未重放。只读guard未执行生产业务写入。

open阶段完整异机archive为302,259字节，SHA256 `7e4301fce8c115dac580f13d7767560b912559df2a0864c9be68935118a5789f`，capture标识`opening.6yuj21k_`，已完整校验。异机capture helper单独更正3枚举字符串、独立审查未解决项0，按实际opening目录取证；此修正未改变M2或重执行生产open。

## 受控发布顺序与最终状态

常规发布器失败会启动旧版本；这不适用于尚未证明旧人员写入契约兼容的新迁移。采用已有受控维护工具组合：同一发布锁、准确主线与收据、构建前完整旧依赖封存及真实恢复、独立候选构建、关闭公共入口与任务/连接排空、准确迁移和授权、维护态文件切换、新运行时仅回环只读验收、证据齐全后开放。冻结的认证例外不能代替公共入口隔离。迁移后失败保持服务停止与维护，文件恢复不回滚或覆盖业务数据。

本轮技术发布终态为opened-and-verified，M2已生产运行并开放；preview的closed/all-freeze和原maintenance的held状态均为历史阶段。最终开放后控制/服务状态以只读guard为准，server与独立Mac证明分列；不把health200、主线CI或文档提交单独当作生产身份或真实员工操作验收。

| 生产阶段 | 最终登记 | 对应证据与边界 |
| --- | --- | --- |
| 独立候选prepare／原包和依赖封存恢复 | resume prepared，literal及derived strict实际恢复/native通过；原strict失败保留 | result `c49e6bff…`与server完整包通过，不改写原strict资格 |
| 异机完整可恢复artifact set | 三件实际内容/header/尾部验证passed；Mac未物化恢复 | 收据`b2abe06a…`，引用已验证Linux实际恢复；全部F/N物理副本未签offhost |
| 切换前新鲜备份与基线 | 新鲜全备/COS GET及v3完整恢复、保护历史摘要已通过 | 备份`42b7cf77…`、保护收据`486008af…`；不混用早期快照 |
| 维护入口、任务与数据库连接排空 | v3自然0取得precutover资格；4副本/4peer拒绝 | maintenance result `5f306f8c…`、closure `1ddce0e7…`，原失败保留 |
| 准确197项迁移、最终授权与历史摘要 | 生产197及逐源checksum通过，旧195事实/保护行保持 | preview `bf9b1f23…`及准确终端checksum，未回填历史 |
| 运行包切换与回环只读验收 | M2实际受限API/Web已证；preview时closed/all freeze | installed `7b66ffcd…`、Web `98274ea9…`；不等同已开放 |
| open监测与server84项 | qgdo5cts自然0；12样本/303.763秒，84/0/0 | result `edac13dc…`、server proof `4057ae1d…`；非独立客户端 |
| Mac独立公网验证 | 3样本18只读GET通过，严格TLS/无proxy/无redirect | proof `e0fa59bc…`；index/两个entry assets匹配及HR401，不含真实业务验收 |
| 恢复控制、开放与发布终态 | opened-and-verified；运行M2、freeze off，原配置/HBA与定时器状态恢复 | readonly guard `9b789c57…`；四副本继续closed/peer拒绝，无业务写入或解冻后数据回滚 |

本轮开放后primary connector再次只读核对#348仍为open、draft=true、merged=false、merge_commit=null，准确头`03b432ba6ce5a976478cfdd5b091166180e025fc`；其真实历史故障根因未在本批证据中得到证明，draft根因阻断保持。本次应用发布/实际运行版本始终以M2及其CI39958036475为准，26项job再次核对全部success。共享根未改；本轮不代替员工办理人事业务、不删除或回填历史数据。后续两份文档单独提交、PR与合并可推进main的docs-only SHA，生产仍运行M2，不把文档SHA当运行SHA，不另部署。

本轮release-v2安全交付包另保存`open-safe-summary.json`、`post-open-readonly-result.json`及`independent-mac-external-acceptance.json`等技术证明；不含raw dump、配置、凭据或业务行。完整私有归档与安全公开摘要的范围分开登记，不能互相冒充。
