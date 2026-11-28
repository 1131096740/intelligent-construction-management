<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import FundPrincipalReturns from "./FundPrincipalReturns.vue";

const route = useRoute();
const applicationId = computed(() => String(route.params.applicationId));
</script>

<template>
  <JgWorkbenchShell title="垫资本金归还">
    <FundPrincipalReturns
      :key="applicationId"
      :application-id="applicationId"
    />
  </JgWorkbenchShell>
</template>
