<template>
  <section>
    <t-card
      title="结算管理"
      bordered
    >
      <t-table
        row-key="id"
        :columns="columns"
        :data="[]"
        empty="暂无结算数据"
      />
    </t-card>
  </section>
</template>

<script setup lang="ts">
const columns = [
  { colKey: "settlementNo", title: "结算编号" },
  { colKey: "contractNo", title: "关联合同" },
  { colKey: "period", title: "结算期间" },
  { colKey: "status", title: "当前节点" },
  { colKey: "ownerDepartment", title: "责任部门" }
];
</script>
