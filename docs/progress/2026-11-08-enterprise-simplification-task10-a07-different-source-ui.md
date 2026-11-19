# 任务10 A07：一次真实不同原源的桌面模板切换

同候选8f7aa1e5+WIP，承接劳务a144正式两轴0。只有既有分类资源文件追加场景及test support opt-in；产品Vue/API/Schema/权限/母版/字体/engine未改，不产生生产/数据库/资源操作、提交或推送。不是模板正式发布/采用、15/26整矩阵或全Task10通过。

## 两个真实source及合法fixture

同真实type other：asset `services/api/assets/templates/generic-contract-v1.docx` SHA ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d → 原probe `scripts/probes/task08-documents/samples/generic-contract-v1.docx` SHA3a3d0fb5e9b5e49798f3773f213296b9cfa224874d14bda6aa89006b63bd366a。二者正文真实不同，不是同源两record：ef9“通用合同/第二条 价款及结算”与3a“其他合同/第二条 价款及付款约定”。

两immutable synthetic published技术catalog，不冒真实publication：ef9复用已核7个explicit range（真实公司名/相对方token，不伪甲方token）；3a用已审7core+2optional canonical。公有catalog type筛选与clean draft目标资格GET、正文原source校核都到；实际草稿true other/main单清单6.5000。旧普通标题人工补句与新增约定先经公开SAVE保存，fixture lease释放后真实桌面同staff登录。

## 实际页面与公开请求链

1. 页面“填写信息/基础信息”改合同名并真实SAVE，等待200 ACK；公有WB/正文确认名称已存、完整oldPlan(含原手改/addition)不变、ef9 typography profile与财务/双方/行事实保持。普通/新增真实t-textarea用公开role/value核，不将region textContent当输入value。
2. ACK之后才开始cancel写计数基准。选择3a弹出手工/新增覆盖确认；确认前及取消后均零新增aggregate PUT，下拉原值、完整version/body与旧checkpoint列表全等。没有绕过确认或伪route/store成功。
3. 再选并明确“确认更换”：唯一PUT.expectedRevision为刚收name ACK，目标layout正确；旧documentBody字段不carry，action精确regenerate/confirmOverwrite。真实200后3a source、内容R递增/F变化、当前已存名称/双方/一行金额保持；target plan无旧manual/addition，旧源独特词/补句/新增完全消失。页面不reload即看到目标章标题和新下拉值、target普通段新ID对应值；只读重载WB/正文稳定。
4. 公有body.savePoints新增同id旧layout/R/完整plan投影；额外原真实GET `/contract-workbench/:contractId` 同staff/numeric2实际200，checkpoint.snapshot精确旧F/完整plan/layout/R，name为“正文重新生成前”。两个响应字段范围不混：body投影没有F，F来自legacy read-only snapshot。原snapshot.kind=contract_body，keys仅kind/protocolVersion/documentBody/layoutTemplateVersionId/documentContentRevision/documentContentFingerprint；无snapshot.version或snapshot.draftData，不宣raw profile被快照/不将by-design结构推为丢失。旧public WB profile→目标无ef9轴另有实际证据。
5. 完整public before/after body/flow/plan/WB、两请求ACK、取消计数、checkpoint全JSON、served源指纹、截图/trace保留。另用fixture独立clean目标公有body对实际切换body的七静态章/签署段ID+format相同，仅此七段，不冒全字形几何。目标2表/7列与签署骨架按目标自身数据，不用旧ordinary ID读目标。

真实两PUT为name SAVE一次与confirm一次；取消零PUT以已收name ACK之后为界，不把正常name保存误算取消副作用。旧source profile reviewed-generic-primary-roles-v1真实存在，目标3a不冒该轴。没有生成新的Word/PDF或宣两源物理等价；此前各自A07物理scope原件保持。

## 原失败、最小fixture维护与最终门

- 首次23.134s实际浏览器启动后失败：新测试把added plan原text当显示value，实际既有“补充条款1：”规范前缀（body-document:919）。非产品RED；保原trace/错误上下文，改新测试明确plan原文与rendered文字。
- 第二次8.464s：name ACK/手改/addition/profile/金额已过，原legacy checkpoint GET404。准确原因是测试fixture未注册真实ContractWorkbenchController，不是生产route/权限缺陷。只加legacyWorkbenchReads opt-in，放在draftWorkbench内注册原真实controller，既有真实service复用；默认false，原same44be不启用。实际全局JWT/RetiredWriteEntry/OperationalFreeze/RateLimit/Permission/Cutover guards注册链未改，没有造GET/开放退役写或私读store。新准备结束封store后只走公有API/UI。
- 第三次完整新scene GREEN13.604s，outer新1/old未选1、inner唯一new grep选1；同源旧scene在同最终测试源下另GREEN22.822s，outer old1/new未选1、inner old grep选1。两个独立证据，不混称15全通过。
- API tsc18.062s；仓库 `tsc --project tsconfig.e2e.json`2.966s；API/Web定向lint1.055/1.205s全过。API tsc/Playwright list不冒完整E2E类型验收。
- final默认Jest实际list排除该browser HTTP与native资源；两明确后缀锚定grep --list各1。原browserFiles/exactIgnore/default配置/Playwright配置、端口/预算/flags均不变，不让默认Jest启动browser。旧HTTP原逻辑仅imports+唯一grep，所有原断言保留；旧e2e原prefix逐字节不改，仅末尾追加新test。

三源码before逐a144全面source库存同；最终执行before/after完整source、private88、runtime一致，后仅2MD；共享58,799前后unchanged。原sidecar/单pdf.worker及Chrome1248输入加入runtime锁，Vite严格源根、单worker/单desktop、retries0、原90s Playwright/220s child/250s HTTP/600s runner预算不放宽。只用正式require_escalated真实启动浏览器，未改flags绕Mach控制、无拒绝需绕行。副本trace/失败一律保留。

新scene目录 `/private/tmp/jg-task10-A07-cross-source-ui-preparation-20261108/tmp/jg-task10-A07-cross-source-ui-NPNxXm`，其browser子目录中public-different-source-complete.json及different-source-confirmed-without-reload.png为末端。old-control独立目录见收据；typed/static guards各原目录封包索引。仍待本scope两轴，机械PAGE独立后继、compact/材料运输业务决定、中央同步/整票/Git不闭合。
