<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
const route = useRoute();
const router = useRouter();
const items = [
  { label: "采购申请", path: "/零星采购工作台" },
  { label: "材料付款", path: "/零星材料付款工作台" },
  { label: "收货确认", path: "/收货确认工作台" }
];
</script>
<template>
  <nav
    class="jg-core-business-nav"
    aria-label="零星材料业务环节"
  >
    <t-button
      v-for="item in items"
      :key="item.path"
      :variant="route.path === item.path ? 'base' : 'outline'"
      :theme="route.path === item.path ? 'primary' : 'default'"
      :aria-current="route.path === item.path ? 'page' : undefined"
      @click="router.push(item.path)"
    >
      {{ item.label }}
    </t-button>
  </nav>
</template>
