export function contractTypeLabel(value?: string | null) {
  return (
    {
      material_purchase: "材料采购合同",
      equipment_rental: "工程机械设备租赁合同",
      labor_subcontract: "劳务分包合同",
      generic_contract: "通用合同",
      professional_subcontract: "专业分包合同"
    }[value ?? ""] ??
    value ??
    "未设置"
  );
}

export function contractVersionStatusLabel(value?: string | null) {
  return (
    {
      draft: "草稿",
      approval_rejected: "已退回",
      in_approval: "审批中",
      pending_seal: "待用章",
      pending_archive: "待归档",
      effective: "已生效",
      voided: "已作废"
    }[value ?? ""] ??
    value ??
    "未知"
  );
}

export function templateStatusLabel(value?: string | null) {
  return (
    {
      draft: "草稿",
      submitted: "待发布",
      published: "已发布",
      stopped: "已停用",
      revoked: "已撤销",
      queued: "排队中",
      processing: "处理中",
      succeeded: "已完成",
      failed: "失败"
    }[value ?? ""] ??
    value ??
    "未知"
  );
}
