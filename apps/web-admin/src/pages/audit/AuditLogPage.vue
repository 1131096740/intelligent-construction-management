<template>
  <section>
    <t-card
      title="审计日志"
      bordered
    >
      <t-table
        row-key="id"
        :columns="columns"
        :data="[]"
        empty="暂无审计日志"
      />
    </t-card>
  </section>
</template>

<script setup lang="ts">
const columns = [
  { colKey: "occurredAt", title: "发生时间" },
  { colKey: "operator", title: "操作人" },
  { colKey: "action", title: "操作类型" },
  { colKey: "target", title: "业务对象" },
  { colKey: "result", title: "结果" }
];
</script>
