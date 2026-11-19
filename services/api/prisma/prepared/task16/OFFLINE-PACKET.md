# 任务16离线源码准备包

`scripts/prepare-task16-registered-pg.cjs` 只整理和校验现有实付 PG 验收源码。它没有数据库、资源或安装模式，不生成安装命令，不读取数据库凭据，也不导入案件或 fixture 模块。

```sh
node scripts/prepare-task16-registered-pg.cjs --prepare --repo /absolute/clean/source --candidate-sha FULL_COMMIT_SHA --output /absolute/new/packet-directory
node scripts/prepare-task16-registered-pg.cjs --verify --packet /absolute/new/packet-directory/packet.json --expected-sha256 PREPARE_STDOUT_PACKET_SHA256
```

第二条命令的 `--expected-sha256` 必须由调用者固定为第一次 prepare 标准输出中的 `packetSha256`；不要从待校验包内自报的校验值取得。代理可记录并传递该值，不需要用户管理凭据。校验包的内部 `sealSha256` 是公开的内容摘要，不是授权或签名；外部固定摘要与准确 Git 源码仍分别核对。

输入必须是准确提交的干净源码树，输出必须是源码树外尚不存在的新目录。检查禁用 Git replacement objects，并比较 HEAD、索引、逐文件 Git blob、真实文件字节和 Git 使用的属主可执行位（`S_IXUSR`）、未跟踪文件及固定目录成员；组或其他用户执行位不替代 Git 的属主执行位。不使用可能触发自定义 clean filter 的 `git status`。忽略产物和已安装依赖不纳入全量源码封存，包中明确标示此限制。不会覆盖旧输出。

包的内容是 JSON 元数据，包含：

- 候选 Git SHA、受测源码文件清单、Schema 与202份正式迁移的名称及摘要。
- 七片准备 SQL 的固定顺序、逐项长度/摘要，以及有明确边界 framing 的合成内容摘要。七片仍在 `prepared/task16/`，不是正式迁移；没有 SQL 安装脚本产物。
- 当前唯一 `registered.null-cross-company.commit` 案件及 `runRegisteredNullCrossCompanyCommit` 顶层导出函数的源码绑定。此清单不注册到全局动态 PG 门禁，也不意味着案件已运行。
- 尚未核实的角色、连接传输、ACL、安装、资源身份、COMMIT/异常/断连/响应丢失/并发和清理前提。

SQL 顺序固定为：`registered-funding.sql`、`registered-history-revision.sql`、`registered-write-authority.sql`、`registered-canonical-proof.sql`、`registered-intercompany.sql`、`registered-canonical-adapter.sql`、`registered-voucher.sql`。额外或缺少 SQL、额外/缺失迁移及脏源码均拒绝。需要的 `jg.task16_runtime_role` 值仍为未知；不得从本包推定角色已获批准，也不得在历史标记授权片之后用 blanket grant 覆盖其边界。

案件识别使用本工具工作区现有的 TypeScript 5.9.3 AST，加载前后核 `typescript.js` SHA-256 为 `3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`。不会从 `--repo` 解析任何依赖，不执行 TypeScript 或解析业务导入。仅接受没有语法诊断的源码、两个准确且未转义命名的顶层具名函数导出、单个静态字面量 return 清单，以及既定案件 ID/handler/金额/独立期望/限制；注释、正则或模板文本、转义名称、嵌套函数、仅 default 导出、任意表达式和额外导出不能冒充清单或处理函数。这是静态语法和绑定检查，不是 TypeScript 语义类型检查或处理函数行为证明。

新工具自身指纹单独记在 `preparer`，并明确 `candidateMembership: not-asserted`；准备现有干净候选时，不宣称尚未提交的准备工具已包含在该候选 SHA。完整依赖闭包不由单个编译器文件指纹推定。

本包始终输出 `SOURCE_ONLY_NOT_EXECUTED`、`executionAllowed:false`、`resourceExecutorImplemented:false`。verify 成功只表示调用者固定的包字节与当前同一准确源码相符，不证明 SQL 可解析/可安装、数据库权限、TLS、真实持久化、防重、故障/竞争、恢复或资源清理。任务16/#398不能因此关闭，17/24及16/42/44的真实验收门保持。

公开 CLI 回归可用 `node --test scripts/prepare-task16-registered-pg.test.cjs`。测试只创建本次独占临时合成 Git 源码与文件包，不创建数据库或容器，不执行 SQL，不修改正式源码/迁移或 CI。
