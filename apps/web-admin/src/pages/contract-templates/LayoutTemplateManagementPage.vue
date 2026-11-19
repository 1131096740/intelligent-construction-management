<template>
  <section class="page jg-responsive-ledger">
    <header class="page-head">
      <div><h1>维护合同模板</h1><p>合同主管上传既有 Word、明确选择填写位置并确认真实预览后发布；新合同手动选择已发布版本。</p></div>
      <t-button v-if="creationCapability?.canCreate" theme="primary" @click="router.push('/合同模板库/版式/new/维护')">上传Word模板</t-button>
    </header>
    <t-alert v-if="message" theme="error" :message="message" />
    <t-empty v-if="!records.length && !loading" description="暂无 Word 模板，请上传源文件" />
    <t-card v-for="record in records" :key="record.id" :title="record.name" class="panel">
      <t-space v-for="version in record.versions" :key="version.id" class="version-row">
        <span>版本 {{ version.versionNo }} · {{ templateStatusLabel(version.status) }}</span>
        <t-button variant="outline" @click="router.push({ path: `/合同模板库/版式/${record.id}/维护`, query: { versionId: version.id } })">维护此版本</t-button>
      </t-space>
    </t-card>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getLayoutCreationCapability, listMaintainedLayouts, type MaintainedLayout } from "../../api/contract-template-mapping.api";
import { formatUnknownApiError } from "../../api/error-message";
import { templateStatusLabel } from "../contracts/contract-labels";
const router = useRouter();
const records = ref<MaintainedLayout[]>([]);
const loading = ref(false);
const creationCapability = ref<{ canCreate: boolean } | null>(null);
const message = ref("");
onMounted(async () => {
  loading.value = true;
  try { [records.value, creationCapability.value] = await Promise.all([listMaintainedLayouts(), getLayoutCreationCapability()]); }
  catch (error) { message.value = formatUnknownApiError(error, "模板读取失败"); }
  finally { loading.value = false; }
});
</script>
<style scoped>
.page-head { display: flex; justify-content: space-between; gap: var(--jg-space-lg); flex-wrap: wrap; }
.panel { margin-top: var(--jg-space-lg); }
.version-row { display: flex; margin-block: var(--jg-space-md); }
</style>
