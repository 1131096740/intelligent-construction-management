<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { fetchRelatedApprovals, type ApprovalProgress } from "../api/approval-progress.api";
import ApprovalProgressPanel from "./ApprovalProgressPanel.vue";
const items = ref<ApprovalProgress[]>([]);
const cursor = ref<string | null>(null);
const selected = ref("");
const loading = ref(false);
const error = ref("");
const refreshVersion = ref(0);
let generation = 0;
let controller: AbortController | null = null;
async function load(more = false) {
  if (loading.value) return;
  const own = ++generation;
  const request = new AbortController();
  controller = request;
  loading.value = true;
  error.value = "";
  try {
    let scanCursor = more ? cursor.value ?? undefined : undefined;
    const visited = new Set<string>();
    for (;;) {
      if (scanCursor) visited.add(scanCursor);
      const result = await fetchRelatedApprovals(scanCursor ? { cursor: scanCursor } : {}, request.signal);
      if (own !== generation) return;
      if (result.nextCursor && visited.has(result.nextCursor)) throw new Error("审批列表翻页异常，请刷新后重试");
      if (result.items.length || !result.nextCursor) {
        items.value = more ? [...items.value, ...result.items] : result.items;
        cursor.value = result.nextCursor;
        if (!more) refreshVersion.value++;
        return;
      }
      scanCursor = result.nextCursor;
    }
  } catch (cause) {
    if (own === generation && !request.signal.aborted) error.value = cause instanceof Error ? cause.message : "读取相关审批失败";
  } finally {
    if (own === generation) { loading.value = false; controller = null; }
  }
}
onMounted(() => { void load(); });
onBeforeUnmount(() => { generation++; controller?.abort(); controller = null; });
</script>
<template>
  <section class="related-approvals">
    <p>查看你发起或参与的全部审批，包括尚未轮到、已经处理和已结束的流程。</p>
    <t-button
      :loading="loading"
      @click="load()"
    >
      刷新相关流程
    </t-button>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <p v-if="!loading && !error && !items.length">
      暂无与你相关的审批流程。
    </p>
    <t-card
      v-for="item in items"
      :key="item.id"
      :bordered="true"
    >
      <strong>{{ item.title }} · {{ item.businessCode }}</strong>
      <p>{{ item.projectName }} · {{ item.applicant.name }}发起 · {{ item.currentNodeName }}</p>
      <t-button
        variant="text"
        @click="selected = selected === item.id ? '' : item.id"
      >
        {{ selected === item.id ? '收起进度' : '查看完整进度与短信催办' }}
      </t-button>
      <ApprovalProgressPanel
        v-if="selected === item.id"
        :instance-id="item.id"
        :refresh-key="String(refreshVersion)"
      />
    </t-card>
    <t-button
      v-if="cursor"
      :loading="loading"
      @click="load(true)"
    >
      加载更多流程
    </t-button>
  </section>
</template>
<style scoped>
.related-approvals { display: grid; gap: var(--jg-space-md); min-width: 0; overflow-wrap: anywhere; }
.related-approvals p { margin: var(--jg-space-sm) 0; }
</style>
