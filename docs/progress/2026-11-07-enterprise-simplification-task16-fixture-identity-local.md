# 任务16 A片：fixture TLS身份与独立observer协议源码

用户本轮对A+B明确回复“确认全部，仅源码与模拟测试”。本片只交A，不将其当B完整driver或真实资源授权。工作树 `/private/tmp/jg-382-task16-fixture-identity-20261107`，分支 `codex/enterprise-task16-fixture-identity-20261107`，准确基线 `080d30d7e48080ce99a2096a5e125843b27d24be`；未提交、推送或修改中央/旧installer树。

## 交付

现有公开fixture身份检查改为真实helper的UUID/db命名协议，保留12位合成标识；绑定预读数据库OID/集群身份和三个独立实际角色/PID，核TLS、replication、独立只读observer及restricted有效资格。每次调用重新查当前会话，旧observer=runtime路径不再接受。原正常case仅将11表snapshot改显式select，不改其ID、独立期望或金融断言；未来ACL列含predicate列的完整说明见[源码说明](../../services/api/prisma/prepared/task16/FIXTURE-IDENTITY-SOURCE.md)。CA/SAN与实际池配置不能从proof字符串或ssl=true推定。

## 公开模拟红绿与当前检查

- 第一条三角色TLS正控对旧fixture实际RED（PG_RESOURCE_DATABASE）→接协议后GREEN。最初`.bin/jest`包装引用本树未存在root依赖目录的工具预置失败单独保留；随后Node20直接调用service的实际jest模块，不安装依赖或改共享字节。
- 原正常case通过公开`runRegisteredNullCrossCompanyCommit`，使用只接受明确列的observer及替代fetch先RED（OBSERVER_SELECT_REQUIRED）→补select后窄1GREEN/18未跑。未绕过原case的独立100/40/60金额、单fact/root、重放与审计断言；这是模拟协议，非真实PG或HTTP。
- 冻结前最终新19项一次全过，0skip/0fail。`/private/tmp/jg-382-task16-fixture-evidence-20261107/final-jest.json` 与 `final-jest.log`。
- 原离线CLI 25/25一次通过，0skip/0fail，24.61秒；`original-cli25.tap`。case AST/源码绑定沿原唯一CLI生效，无修改CLI或弱化静态条件。
- API类型检查与全src lint各退出0，日志`typecheck.log`、`lint.log`；`git diff --check`通过。Node20.20.2及既有central依赖仅本树ignored读取链接，无安装、生成client或共享依赖修改。没有根node_modules链接或其他未跟踪依赖。

冻结三源码SHA256：fixture `c3254c1bbbe2c6a689ea35ad003f70b02efa8a16ce3023b223e1e844b67ebb77`；cases `49a80afb9b8739c8648096ee221ddcfc5031e8addc32c924993085bd47d37ad2`；测试 `735270e6fe066107066890b4b6dc40801e911d5c95465dc31b6d932f41748718`。这些是未提交候选字节，不是基线080d已包含实现或最终SHA验收。

## 保持的门

独立两轴审查与整合尚待主控，不能预称其通过。尚未真实PG解析SQL、连接资源或核安装/ACL/TLS/COMMIT；CA/SAN负控、完整driver/三角色权限/资源身份与清理、故障/断连/响应丢失/并发均未闭合。没有SQL/Docker/资源/端口/证书创建、真实业务/银行/短信/COS/部署或生产操作。#398保持OPEN，17/24阻塞，16/42/44门保持；13/45不变。
