# B4 owner TLS 源码合同（未连接验收）

本轮按用户已确认“数据库身份检查和专用执行器源码…模拟接口测试角色隔离、TLS/集群身份变化、执行顺序、首败停止与清理：确认全部，仅源码与模拟测试”。原公共接口仍为`runTask16RegisteredPg(options, adapters)`；`verifyOwnerTransport:{command(executable,args,control)}`仅是该TLS模拟边界的接线，签名沿B3 command。resource全部显式模拟，不回填真实资源/SQL；缺失或额外key对象在资源前拒绝。注入永SIMULATED；不新增CLI/mock旗标，不测试私有函数或B4物理OS事件。

新增专用Task16 owner probe，沿旧三模式healthy/certificate-negative/plaintext-negative的拒绝合同，不扩旧Task01接口。输入是独占私有受限FD读取JSON，owner随机凭证只在env指向的该文件中，不在argv/回执。probe固定owner、loopback/本次DB、strictCA、单连接/5秒连接池预算、Prisma5.22/固定engine，finally disconnect；健康只读身份SQL及nonce，错误CA/SAN要求P1011且具体证书标记，普通网络/auth错误不能充当证书反例。明文要求P1010并精确cursor之后owner/DB的no-encryption HBA证据。

阶段核入口source候选成员、node/python工具及CA/wrongCA受限文件、证书摘要/peer DER、run/source/container/network/daemon/image/port/DB及私有材料擦除标志，固定最初描述符，每次await后复核。每次真实probe前调用封存runtime-manifest.py比较原五个runtime树，cross-check有界私有receipt/root/差异/manifest摘要，再检查源码和工具。所有工具/SQL/证书/log方法在本地测试都是显式协议模拟。

固定顺序为owner独立verify-full TCP只读身份→宿主healthy→wrongCA→healthy→wrongSAN（必须见呈现DER）→finally恢复correct（先核原resource身份，后核正确呈现）→healthy→cursor/plain/HBA→healthy→owner独立身份。宿主与ownerSQL角色/DB OID/cluster/SSL/PG16/origin/readOnly一致，才返回B3需要的OWNER_TLS_CONTROLS_VERIFIED；返回financialAcceptance/tlsAcceptance均false。

SAN首败保留；恢复失败另记UNKNOWN_DO_NOT_CONTINUE，不推进迁移。owner私有输入文件只删除最初见证的本次文件，拒绝删除替换文件；擦除失败保留首败并另记unknown，之后metadata目录成功删除也不得将该unknown改为ERASED。公开driver仍finally清理已登记App/client/resource。metadata比较产物只在本次私有目录内按固定文件名清理，不删除未知条目。

B3已审进程组控制器仅机械抽成生产共用task16-bounded-command.cjs，保其TERM/KILL/deadline、无stdio监听及组消失才settled逻辑。B4 command模拟不调用此native函数；该OS实现没有在B4被真实运行或获得物理TLS/清理实证。

原生default仍缺六stage：baseline ACL、registered ACL、三角色客户端、App、fixture、正常case；资源前拒绝。尚无实际证书/TCP/PG/SQL/Prisma子进程、COMMIT/竞争/清理验收，#398及17/24、16/42/44门保持。所有提交及最终push HEAD须带[skip ci]；本作者仅freeze，独审前不commit/push。
