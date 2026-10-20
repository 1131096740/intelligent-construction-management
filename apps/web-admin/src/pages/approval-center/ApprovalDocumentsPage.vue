<template>
  <section class="approval-documents jg-responsive-ledger">
    <header class="page-head">
      <div>
        <h1>审批单留存</h1>
        <p>下载已最终审批通过的单据，用于纸质打印和公司留存。</p>
      </div>
      <t-button
        :loading="loading"
        @click="load(false)"
      >
        刷新
      </t-button>
    </header>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-input
      v-model="search"
      clearable
      placeholder="按单据类型或单号筛选已加载单据"
      aria-label="筛选审批单"
    />
    <t-table
      row-key="id"
      :data="visibleItems"
      :columns="columns"
      :loading="loading"
      :empty="'暂无可留存的审批单'"
    >
      <template #approvedAt="{ row }">
        {{ new Date(row.approvedAt).toLocaleString('zh-CN', { hour12: false }) }}
      </template>
      <template #action="{ row }">
        <t-button
          v-if="row.available"
          theme="primary"
          variant="text"
          @click="select(row)"
        >
          下载 PDF
        </t-button>
        <span v-else>{{ row.unavailableReason }}</span>
      </template>
    </t-table>
    <t-button
      v-if="nextCursor"
      :loading="loading"
      variant="outline"
      @click="load(true)"
    >
      继续加载
    </t-button>
    <t-dialog
      v-model:visible="dialogVisible"
      header="下载审批单"
      :confirm-btn="{ content: '下载 PDF', loading: downloading, disabled: !password || !reason.trim() }"
      :close-on-overlay-click="false"
      @confirm="download"
      @close="clearPassword"
    >
      <p>{{ selected?.title }} · {{ selected?.code }}</p>
      <t-form label-align="top">
        <t-form-item label="留存用途">
          <t-input
            v-model="reason"
            placeholder="例如：公司财务纸质归档"
          />
        </t-form-item>
        <t-form-item label="当前登录密码">
          <t-input
            v-model="password"
            type="password"
            autocomplete="current-password"
          />
        </t-form-item>
      </t-form>
      <t-alert
        v-if="downloadError"
        theme="error"
        :message="downloadError"
      />
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { approvalDocumentCapability, listApprovalDocuments, type ApprovalDocumentItem } from "../../api/approval-forms.api";
import { downloadApprovalForm } from "../../api/core-flow-read.api";

const items = ref<ApprovalDocumentItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(false);
const error = ref("");
const search = ref("");
const visibleItems = computed(() => items.value.filter(row => `${row.title} ${row.code}`.includes(search.value.trim())));
const columns = [
  { colKey: "title", title: "单据类型", minWidth: 160 },
  { colKey: "code", title: "单号", minWidth: 160 },
  { colKey: "approvedAt", title: "最终审批时间", minWidth: 180 },
  { colKey: "action", title: "留存", minWidth: 240 }
];
const selected = ref<ApprovalDocumentItem | null>(null);
const dialogVisible = ref(false);
const downloading = ref(false);
const password = ref("");
const reason = ref("公司纸质归档");
const downloadError = ref("");
async function load(more: boolean) {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const result = await listApprovalDocuments(more ? nextCursor.value ?? undefined : undefined);
    const merged = more ? [...items.value, ...result.items] : result.items;
    items.value = [...new Map(merged.map(row => [row.id, row])).values()];
    nextCursor.value = result.nextCursor;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "审批单读取失败，请重试"; }
  finally { loading.value = false; }
}
function select(row: ApprovalDocumentItem) { selected.value = row; password.value = ""; downloadError.value = ""; dialogVisible.value = true; }
function clearPassword() { password.value = ""; }
async function downloadRetainedApprovalFormWithCapability(
  businessType: string,
  businessId: string,
  body: Parameters<typeof downloadApprovalForm>[2]
) {
  const capability = await approvalDocumentCapability(businessType, businessId);
  const operationAllowed = capability.available;
  if (!operationAllowed) throw new Error("当前审批单不可下载，请刷新后重试");
  return downloadApprovalForm(businessType, businessId, body);
}
async function download() {
  if (!selected.value || downloading.value || !password.value || !reason.value.trim()) return;
  downloading.value = true;
  downloadError.value = "";
  try {
    await downloadRetainedApprovalFormWithCapability(selected.value.businessType, selected.value.businessId, { confirmationPassword: password.value, downloadReason: reason.value.trim() });
    dialogVisible.value = false;
  } catch (cause) { downloadError.value = cause instanceof Error ? cause.message : "下载失败，请重试"; }
  finally { downloading.value = false; clearPassword(); }
}
onMounted(() => load(false));
</script>

<style scoped>
.approval-documents { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; gap: var(--jg-space-4, 16px); }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: var(--jg-space-4, 16px); }
.page-head h1 { margin: 0; }
.page-head p { color: var(--jg-text-secondary); }
</style>
