# 公共现金交接的受限运行角色

本目录是 #407 在既有受限付款和资金转款部署上的后继。空库迁移使用既有迁移入口，前置迁移为 20261118150000_registered_fund_account_transfers，本任务继续到 20261118170000_public_cash_custody_handover。

1. 在获准的非生产候选中核对迁移账已到该终点，保留原 Task16 注册付款和 Task24 资金转款安装材料。
2. 核对同一受限运行角色已按 Task24 准备。在同一数据库事务设置 jg.task16_runtime_role，再执行本目录的 SQL。安装会拒绝没有既有资金账户版本和转款修订写权限的角色。
3. 核对该角色可以查询和追加三张交接表，仅能更新 PublicCashCustody.currentCustodianId 列。核对历史、原始首任列无更新、删除权限，并验证财务写入冻结规则覆盖本次三个写入口。
4. 用明确的本地隔离候选验证 HTTP。run-task398-shared-standard-local.cjs 的 --cash-handover-real 模式要求干净候选、完整迁移和受限角色，独立读回余额与事实并清理自建资源。正式环境依据授权的发布计划执行。
