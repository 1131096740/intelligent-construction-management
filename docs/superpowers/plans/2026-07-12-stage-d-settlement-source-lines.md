# Stage D Settlement Source Lines Plan

**Goal:** 选中有效合同版本后加载唯一版本的合同清单源行及已占用金额，为结算网页表格、canonical 重算和 Excel 导入建立共同上游。

## Backend

- 新增 `settlement.create` 保护的只读 endpoint，以 `contractVersionId` 为唯一坐标。
- missing/non-effective/voided fail closed；只读取该版本 ContractBill/Rows，按 bill sort + row sort + id 稳定排序。
- 批量聚合 active settlement statuses 下既有 SettlementLine 占用；rejected/withdrawn/voided 不占用。
- 金额/BIGINT、Decimal 数量全部返回字符串；不把缺失 quantity 猜成 0。
- 返回 contractAmount、settledAmount、remainingAmount、provisional、settlementBasis 与负余额异常；零 Settlement/Line/audit 写入。
- 资源 ID 项目解析与 Guard 403 必须由 contractVersionId 决定，忽略伪造 projectId。

## Web

- 新增 settlement-workbench API；选择合同后加载，切换时防旧响应回填。
- 在现有创建区先展示只读清单预览、合计、加载/错误/空态；不宣称已是可编辑工作台，不改变现有创建 payload。

## Verification

- effective/非 effective、跨版本隔离、active 聚合、重复行、超安全整数、Decimal 字符串、空清单、稳定排序、零写；Web URL/竞态/空态；API/Web gates 与独立复审。
