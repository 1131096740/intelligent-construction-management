<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { useAuthStore } from "../../../auth/auth.store";
import type { GeneralProcurementRequestLine, GeneralProcurementCategory } from "@jiangkong/shared-domain";
import { createProcurement, ProcurementHttpError, ProcurementPreflightError, fetchProcurementOptions, fetchProcurementDetail, updateProcurement, type ProcurementDetail, type ProcurementOptions, type ProcurementRequestDraft } from "../../../api/general-procurement.api";
import { formatUnknownApiError } from "../../../api/error-message";
import GeneralProcurementRequestGrid from "./GeneralProcurementRequestGrid.vue";
import LegacyProcurementDraftDrawer from "./LegacyProcurementDraftDrawer.vue";
const props = defineProps<{ visible: boolean; detail?: ProcurementDetail }>();
const emit = defineEmits<{ "update:visible": [value: boolean]; saved: [id: string] }>();
const categoryOptions = computed(() => options.value?.requestEntryDefinition?.fields.find(field => field.key === "category")?.options?.map(item => ({ value: item.value, label: item.label })) ?? []);
const legacy = computed(() => Boolean(props.detail && props.detail.requestProtocolVersion !== 2));
const options = ref<ProcurementOptions>(); const loading = ref(false); const busy = ref(false); const error = ref("");
const scope = ref<"project" | "company_daily">("company_daily"); const projectId = ref(""); const companyEntityId = ref(""); const category = ref<GeneralProcurementCategory>("office_supplies");
const reason = ref(""); const estimate = ref(""); const requestKey = ref(""); const lines = ref<GeneralProcurementRequestLine[]>([]);
const pendingPayload = ref<(ProcurementRequestDraft & { requestKey: string })>();
const baseline = ref(""); const dirty = computed(() => baseline.value !== JSON.stringify([scope.value, projectId.value, companyEntityId.value, category.value, reason.value, estimate.value, lines.value]));
const closeConfirm = ref(false); const history = ref<GeneralProcurementRequestLine[][]>([]); const editorPending = ref(false);
const auth = useAuthStore(); const ownerId = ref("");
function changeLines(next: GeneralProcurementRequestLine[]) {
  if (JSON.stringify(next) === JSON.stringify(lines.value)) return;
  history.value.push(lines.value.map(line => ({ ...line })));
  lines.value = next;
}
function undoLast() { const previous = history.value.pop(); if (previous) lines.value = previous; }
function copyLast() { const last = lines.value.at(-1); if (last) changeLines([...lines.value, { ...last, id: crypto.randomUUID() }]); }
function keydown(event: KeyboardEvent) {
  if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable=true]")) return;
  event.preventDefault(); undoLast();
}
function beforeUnload(event: BeforeUnloadEvent) { if (props.visible && (dirty.value || pendingPayload.value)) { event.preventDefault(); event.returnValue = ""; } }
onMounted(() => window.addEventListener("beforeunload", beforeUnload));
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
onBeforeRouteLeave(() => {
  if (!props.visible || (!dirty.value && !pendingPayload.value)) return true;
  error.value = "当前填写尚未保存，请先保存草稿或取消本次填写后再离开";
  return false;
});
const blankLine = (): GeneralProcurementRequestLine => ({ id: crypto.randomUUID(), name: "", specification: null, unit: null, quantity: null, unitPrice: null, estimatedAmount: null, requiredOn: null, note: null });
let generation = 0;
watch(() => props.visible, async visible => {
  const own = ++generation; if (!visible || legacy.value) return;
  loading.value = true; error.value = ""; history.value = []; editorPending.value = false; ownerId.value = auth.user?.id ?? ""; pendingPayload.value = undefined; requestKey.value = crypto.randomUUID();
  try {
    const result = await fetchProcurementOptions(); if (own !== generation || !props.visible) return;
    if (result.requestEntryDefinition?.key !== "general_procurement.request" || result.requestEntryDefinition.version !== 2) throw new Error("申请字段已更新，请刷新后再填写");
    options.value = result; const row = props.detail;
    scope.value = row?.scope === "project" ? "project" : "company_daily"; projectId.value = row?.projectId ?? ""; companyEntityId.value = row?.companyEntityId ?? "";
    category.value = row?.category ?? "office_supplies"; reason.value = row?.reason ?? ""; estimate.value = row?.estimatedAmount ?? "";
    lines.value = row?.lines?.length ? row.lines.map(line => ({ ...line })) : [blankLine()];
    baseline.value = JSON.stringify([scope.value, projectId.value, companyEntityId.value, category.value, reason.value, estimate.value, lines.value]);
  } catch (cause) { error.value = formatUnknownApiError(cause, "申请表读取失败，请重试"); }
  finally { if (own === generation) loading.value = false; }
});
function close() { if (busy.value) return; if (dirty.value || pendingPayload.value) closeConfirm.value = true; else emit("update:visible", false); }
let createMayHaveSent = false;
async function save() {
  if (busy.value || loading.value) return; busy.value = true; error.value = ""; createMayHaveSent = true;
  try {
    if (!ownerId.value || auth.user?.id !== ownerId.value) throw new Error("登录状态已变化，请保留当前填写，重新登录后再核对");
    if (editorPending.value) throw new Error("请先确认当前单元格的填写，再保存草稿");
    if (!lines.value.length || lines.value.some(line => !line.name.trim())) throw new Error("请为每一行填写采购名称，其他未定内容可留空");
    if (scope.value === "project" && !projectId.value) throw new Error("请选择所属项目");
    const payload: ProcurementRequestDraft = { requestProtocolVersion: 2, scope: scope.value, projectId: scope.value === "project" ? projectId.value : null,
      companyEntityId: companyEntityId.value || null, category: category.value, reason: reason.value.trim(), requestedAmountCents: null, estimatedAmount: estimate.value.trim() || null,
      lines: lines.value.map(line => ({ ...line })) };
    let saved: { id: string };
    if (props.detail) saved = await updateProcurementWithCapability(props.detail.id, { ...payload, revision: props.detail.revision });
    else {
      createMayHaveSent = false;
      pendingPayload.value ??= { ...payload, requestKey: requestKey.value };
      saved = await createProcurementWithCapability(pendingPayload.value);
    }
    pendingPayload.value = undefined; baseline.value = JSON.stringify([scope.value, projectId.value, companyEntityId.value, category.value, reason.value, estimate.value, lines.value]); emit("update:visible", false); emit("saved", saved.id);
  } catch (cause) {
    if ((!props.detail && !createMayHaveSent) || cause instanceof ProcurementPreflightError || (cause instanceof ProcurementHttpError && [400, 401, 403, 404, 422].includes(cause.status))) pendingPayload.value = undefined;
    error.value = !props.detail && !createMayHaveSent ? "申请权限读取失败，尚未发送保存请求，填写已保留，请重试" : formatUnknownApiError(cause, "草稿保存失败，填写已保留，请核对后重试");
  }
  finally { busy.value = false; }
}
async function createProcurementWithCapability(body: Parameters<typeof createProcurement>[0]) {
  const capability = await fetchProcurementOptions();
  const operationAllowed = capability.canCreate;
  if (!operationAllowed) throw new Error("当前账号不能发起综合采购申请，请联系综合部");
  createMayHaveSent = true;
  return createProcurement(body);
}
async function updateProcurementWithCapability(id: string, body: Parameters<typeof updateProcurement>[1]) {
  const editCapability = await fetchProcurementDetail(id);
  const editAllowed = editCapability.canEdit;
  if (!editAllowed) throw new Error("当前账号不能修改此申请");
  return updateProcurement(id, body);
}
</script>
<template>
  <LegacyProcurementDraftDrawer
    v-if="legacy && detail"
    :visible="visible"
    :detail="detail"
    @update:visible="emit('update:visible', $event)"
    @saved="emit('saved', $event)"
  />
  <t-drawer
    v-else
    :visible="visible"
    :header="detail ? '修改综合采购申请' : '新建综合采购申请'"
    size="min(100vw, 1100px)"
    :close-on-overlay-click="false"
    :footer="false"
    @update:visible="!$event && close()"
  >
    <t-loading v-if="loading" />
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-alert
      theme="info"
      message="先明确需要什么；规格、数量、单价、预计总价、到位日期及说明未定可留空。保存只是草稿，提交后才进入审批。"
    />
    <t-alert
      v-if="pendingPayload"
      theme="warning"
      message="上次保存结果待核对，再次保存将使用同一份内容和提交标识，避免重复生成。"
    />
    <div
      class="request-form"
      :aria-busy="busy || loading"
      @keydown="keydown"
    >
      <t-radio-group
        v-model="scope"
        :disabled="busy || !!pendingPayload"
        aria-label="采购范围"
      >
        <t-radio value="company_daily">
          公司日常采购
        </t-radio><t-radio value="project">
          项目采购
        </t-radio>
      </t-radio-group>
      <t-select
        v-if="scope === 'project'"
        v-model="projectId"
        :options="options?.projects.map(item => ({ value: item.id, label: item.name })) ?? []"
        :disabled="busy || !!pendingPayload"
        placeholder="请选择所属项目"
        aria-label="所属项目"
        filterable
      />
      <t-select
        v-model="companyEntityId"
        :options="options?.companies.map(item => ({ value: item.id, label: item.name })) ?? []"
        :disabled="busy || !!pendingPayload"
        placeholder="承担公司未定可留空"
        aria-label="费用承担公司"
        clearable
        filterable
      />
      <t-select
        v-model="category"
        :options="categoryOptions"
        :disabled="busy || !!pendingPayload"
        aria-label="采购类别"
      />
      <t-input
        v-model="estimate"
        :disabled="busy || !!pendingPayload"
        placeholder="整单独立预计金额（元，最多四位小数），未定可留空"
        aria-label="整单独立预计金额"
      />
      <t-textarea
        v-model="reason"
        :disabled="busy || !!pendingPayload"
        placeholder="用途或补充说明，未定可留空"
        aria-label="用途说明"
      />
      <GeneralProcurementRequestGrid
        :definition="options?.requestEntryDefinition"
        :lines="lines"
        :readonly="busy || !!pendingPayload"
        @update:lines="changeLines"
        @editor-input="editorPending = $event.pending"
      />
      <t-space break-line>
        <t-button
          theme="default"
          :disabled="busy || !!pendingPayload"
          @click="changeLines([...lines, blankLine()])"
        >
          添加清单行
        </t-button><t-button
          theme="default"
          :disabled="busy || !!pendingPayload || lines.length <= 1"
          @click="changeLines(lines.slice(0, -1))"
        >
          删除末行
        </t-button><t-button
          theme="default"
          :disabled="busy || !!pendingPayload || !lines.length"
          @click="copyLast"
        >
          复制末行
        </t-button><t-button
          theme="default"
          :disabled="busy || !!pendingPayload || !history.length || editorPending"
          @click="undoLast"
        >
          撤销上一步
        </t-button>
      </t-space>
      <p v-if="editorPending">
        请按回车确认当前单元格的填写，再保存草稿。
      </p>
      <t-space break-line>
        <t-button
          :loading="busy"
          :disabled="loading || editorPending"
          @click="save"
        >
          {{ pendingPayload ? '核对并保存同一次草稿' : '保存草稿' }}
        </t-button><t-button
          theme="default"
          :disabled="busy"
          @click="close"
        >
          取消
        </t-button>
      </t-space>
    </div>
  </t-drawer>
  <t-dialog
    v-model:visible="closeConfirm"
    header="保留当前填写"
    :body="pendingPayload ? '保存结果待核对，请先到台账核对。结束填写不会撤销服务器记录，之后重新新建会是另一笔申请。' : '当前填写尚未保存，离开会丢失页面上的内容。'"
    confirm-btn="继续填写"
    :cancel-btn="pendingPayload ? '已核对，结束填写' : '放弃当前填写'"
    @confirm="closeConfirm = false"
    @cancel="emit('update:visible', false)"
  />
</template>
<style scoped>
.request-form { display: grid; grid-template-columns: minmax(0, 1fr); min-width: 0; max-width: 100%; gap: var(--jg-space-md); margin-top: var(--jg-space-md); }
.request-form > * { min-width: 0; max-width: 100%; }
</style>
