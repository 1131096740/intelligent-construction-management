# Stage B Batch Role Removal Preview Plan

**Goal:** 为多人员、多岗位撤销提供服务端累计影响预览，识别“每条单独安全、组合后无人可批”的风险；本切片只读，不新增一键批量写入。

## Contract

- 新增 global `super_admin` 专用 batch preview endpoint 与运行时 DTO；目标 2..20 条，逐条只允许 `remove`，拒绝未知字段、重复坐标与非法 scope/projectId。
- 在单一数据库一致性读事务、同一 `evaluatedAt` 中按稳定请求顺序累计模拟；前一步的唯一规范 assignment 从后续事实中排除。
- 每步复用单条撤销的 target 解析、legacy/最后管理员/审批、自审和 hash 规则；任一步阻断即停止，不把后续目标伪装成已安全评估。
- 返回 ordered steps、组合 `canApply`、已模拟条数、阻断目标和 combined hash；组合 hash 绑定完整目标顺序、每步 snapshot 与服务端 assignment ID。
- 同时把 remove 影响扫描补齐为当前节点至冻结流程末尾；冻结数组顺序保留，实例/节点稳定排序。
- 不新增 batch apply。Web 后续可展示组合预览，但实际仍逐条重新 preview + 验密 apply，遇 409/阻断即停。

## Verification

- 两个不同人员持同一审批岗：各自单独撤销安全，组合第二步阻断。
- 重复目标、超过上限、global/project 坐标、最后管理员、legacy shadow、未来节点阻断、稳定 hash/顺序。
- preview 零岗位/token/audit 写入；目标测试、API typecheck/lint/build/business-errors、独立复审。
