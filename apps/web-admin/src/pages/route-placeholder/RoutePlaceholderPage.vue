<template>
  <section class="placeholder-page">
    <h1>{{ title }}</h1>
    <p>{{ description }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const title = computed(() => String(route.meta.title ?? "业务模块"));
const description = computed(() =>
  title.value === "项目经营"
    ? "项目经营模块已预留，资金全貌数据按后续经营口径接入。"
    : "工作入口已预留。"
);
</script>

<style scoped>
.placeholder-page {
  max-width: 720px;
  padding: 24px;
  background: #fff;
  border: 1px solid #dce1e8;
  border-radius: 8px;
}

h1 {
  margin: 0 0 12px;
  font-size: 22px;
}

p {
  margin: 0;
  color: #5f6673;
}
</style>
