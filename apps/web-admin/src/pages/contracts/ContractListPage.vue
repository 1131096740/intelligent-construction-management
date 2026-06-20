<template>
  <section>
    <t-card
      title="合同台账"
      bordered
    >
      <t-table
        row-key="id"
        :columns="columns"
        :data="[]"
        empty="暂无合同数据"
      />
    </t-card>
  </section>
</template>

<script setup lang="ts">
const columns = [
  { colKey: "contractNo", title: "合同编号" },
  { colKey: "name", title: "合同名称" },
  { colKey: "project", title: "项目" },
  { colKey: "status", title: "当前节点" },
  { colKey: "ownerDepartment", title: "责任部门" }
];
</script>
