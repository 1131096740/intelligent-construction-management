<template>
  <section>
    <t-card
      title="付款管理"
      bordered
    >
      <t-table
        row-key="id"
        :columns="columns"
        :data="[]"
        empty="暂无付款数据"
      />
    </t-card>
  </section>
</template>

<script setup lang="ts">
const columns = [
  { colKey: "paymentNo", title: "付款编号" },
  { colKey: "settlementNo", title: "关联结算" },
  { colKey: "approvalStatus", title: "审批状态" },
  { colKey: "paymentStatus", title: "实付状态" },
  { colKey: "ownerDepartment", title: "责任部门" }
];
</script>
