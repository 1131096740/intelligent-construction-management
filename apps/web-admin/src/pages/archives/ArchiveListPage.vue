<template>
  <section>
    <t-card
      title="资料库"
      bordered
    >
      <t-table
        row-key="id"
        :columns="columns"
        :data="[]"
        empty="暂无归档资料"
      />
    </t-card>
  </section>
</template>

<script setup lang="ts">
const columns = [
  { colKey: "documentNo", title: "资料编号" },
  { colKey: "businessType", title: "业务类型" },
  { colKey: "archiveStatus", title: "归档状态" },
  { colKey: "confirmedBy", title: "确认人" },
  { colKey: "confirmedAt", title: "确认时间" }
];
</script>
