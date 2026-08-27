<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import {
  confirmWageStatement,
  createApprovedWageSource,
  createWageStatementDraft,
  fetchWageStatementCapabilities,
  fetchWageStatementImportPreview,
  fetchWageStatementSummary,
  fetchWageStatementWorkbench,
  returnWageStatement,
  submitWageStatement,
  WageStatementApiError,
  type WageStatementCapabilities,
  type WageStatementImportPreviewReadModel,
  type WageStatementSummaryReadModel,
  type WageStatementWorkbenchItem
} from "../../api/wage-statement.api";
import JgResultState from "../../components/JgResultState.vue";
import JgStatusTag from "../../components/JgStatusTag.vue";
import JgWorkbenchShell from "../../components/JgWorkbenchShell.vue";
import { formatUnknownApiError } from "../../api/error-message";

const noCapabilities: WageStatementCapabilities = { canPrepare: false, canSubmit: false, canReturn: false, canConfirm: false };
const loading = ref(false);
const detailLoading = ref(false);
const commandLoading = ref(false);
const importLoading = ref(false);
const loadError = ref("");
const detailError = ref("");
const importError = ref("");
const rows = ref<WageStatementWorkbenchItem[]>([]);
const capabilities = ref<WageStatementCapabilities>({ ...noCapabilities });
const selected = ref<WageStatementWorkbenchItem | null>(null);
const summary = ref<WageStatementSummaryReadModel | null>(null);
const importPreview = ref<WageStatementImportPreviewReadModel | null>(null);
const localImportPreview = ref<LocalApprovedSourcePreview | null>(null);
const localApprovedSource = ref<Record<string, unknown> | null>(null);
const localImportCommand = ref<{ sourceKey: string; draftKey: string } | null>(null);
const returnDialogVisible = ref(false);
const returnReason = ref("");
const pendingCommandKeys = new Map<string, string>();
const drawerVisible = computed({
  get: () => selected.value !== null,
  set: (visible: boolean) => { if (!visible) closeDetail(); }
});
const activeCapabilities = computed(() => summary.value?.capabilities ?? noCapabilities);
const canSubmitSelected = computed(() => selected.value?.status === "draft" && activeCapabilities.value.canSubmit);
const canReturnSelected = computed(() => selected.value?.status === "submitted" && activeCapabilities.value.canReturn);
const canConfirmSelected = computed(() => selected.value?.status === "submitted" && activeCapabilities.value.canConfirm);
const canImportApprovedSource = computed(() => capabilities.value.canPrepare);

interface LocalApprovedSourcePreview {
  employmentCompanyLabel: string;
  wageMonth: string;
  sourceLabel: string;
  personLineCount: number;
  positionCategoryCount: number;
  projectAllocationCount: number;
}

const columns = [
  { colKey: "wageMonth", title: "工资月份", width: 120 },
  { colKey: "employmentCompanyName", title: "承担公司", minWidth: 200 },
  { colKey: "sourceLabel", title: "来源版本", minWidth: 180 },
  { colKey: "status", title: "状态", width: 120 },
  { colKey: "revision", title: "修订", width: 90 },
  { colKey: "personLineCount", title: "人员记录数", width: 130, align: "right" as const },
  { colKey: "positionCategoryCount", title: "岗位类别数", width: 130, align: "right" as const },
  { colKey: "projectAllocationCount", title: "项目分配记录数", width: 150, align: "right" as const },
  { colKey: "updatedAt", title: "更新时间", width: 165 },
  { colKey: "actions", title: "查看", width: 100, fixed: "right" as const }
];

const categoryColumns = [
  { colKey: "positionCategoryLabel", title: "岗位类别", minWidth: 180 },
  { colKey: "personLineCount", title: "人员记录数", width: 150, align: "right" as const },
  { colKey: "projectAllocationCount", title: "项目分配记录数", width: 170, align: "right" as const }
];

function statusTone(status: WageStatementWorkbenchItem["status"]) {
  if (status === "confirmed") return "success" as const;
  if (status === "submitted") return "warning" as const;
  return "default" as const;
}

function dateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function commandKeyFor(statementId: string, action: "submit" | "return" | "confirm", revision: number, reason = "") {
  return `${statementId}:${action}:${revision}:${reason}`;
}

function idempotencyKeyFor(commandKey: string) {
  const idempotencyKey = pendingCommandKeys.get(commandKey) ?? crypto.randomUUID();
  pendingCommandKeys.set(commandKey, idempotencyKey);
  return idempotencyKey;
}

function isKnownBusinessRejection(error: unknown): error is WageStatementApiError {
  return error instanceof WageStatementApiError && error.status >= 400 && error.status < 500;
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseLocalApprovedSource(text: string): { payload: Record<string, unknown>; preview: LocalApprovedSourcePreview } {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("请选择格式正确的外部批准工资 JSON 文件。");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("外部批准工资资料格式不符合导入要求。");
  }
  const record = payload as Record<string, unknown>;
  const wageMonth = stringField(record, "wageMonth");
  const sourceVersion = stringField(record, "sourceVersion");
  const companyLabel = stringField(record, "employmentCompanyName") ?? "已选择承担公司（服务端校验）";
  const lines = record.approvedPersonLines;
  if (!wageMonth || !sourceVersion || !Array.isArray(lines) || lines.length === 0) {
    throw new Error("外部批准工资资料缺少月份、来源版本或人员记录。");
  }
  const categories = new Set<string>();
  let projectAllocationCount = 0;
  for (const line of lines) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw new Error("外部批准工资资料的人员记录格式不符合导入要求。");
    }
    const positionCategory = stringField(line as Record<string, unknown>, "positionCategory");
    if (positionCategory) categories.add(positionCategory);
    const allocations = (line as Record<string, unknown>).projectAllocations;
    if (Array.isArray(allocations)) projectAllocationCount += allocations.length;
  }
  return {
    payload: record,
    preview: {
      employmentCompanyLabel: companyLabel,
      wageMonth,
      sourceLabel: sourceVersion,
      personLineCount: lines.length,
      positionCategoryCount: categories.size,
      projectAllocationCount
    }
  };
}

function sourceTotalCents(lines: unknown[]) {
  let total = 0n;
  for (const line of lines) {
    const value = line && typeof line === "object" && !Array.isArray(line)
      ? (line as Record<string, unknown>).approvedAmountCents
      : null;
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      throw new Error("外部批准工资资料的金额格式不符合导入要求。");
    }
    total += BigInt(value);
  }
  return total.toString();
}

async function readApprovedSourceFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || importLoading.value || !canImportApprovedSource.value) return;
  importError.value = "";
  localImportPreview.value = null;
  localApprovedSource.value = null;
  localImportCommand.value = null;
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("无法读取所选文件。"));
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.readAsText(file, "utf-8");
    });
    const parsed = parseLocalApprovedSource(text);
    localApprovedSource.value = parsed.payload;
    localImportPreview.value = parsed.preview;
    localImportCommand.value = { sourceKey: crypto.randomUUID(), draftKey: crypto.randomUUID() };
  } catch (error) {
    importError.value = formatUnknownApiError(error, "外部批准工资资料解析失败。");
  }
}

async function createImportedDraft() {
  const sourcePayload = localApprovedSource.value;
  if (!sourcePayload || !localImportPreview.value || !localImportCommand.value || importLoading.value || !canImportApprovedSource.value) return;
  const lines = sourcePayload.approvedPersonLines;
  if (!Array.isArray(lines)) {
    importError.value = "外部批准工资资料格式不符合导入要求。";
    return;
  }
  importLoading.value = true;
  importError.value = "";
  try {
    await createImportedDraftWithCapability({
      ...sourcePayload,
      idempotencyKey: localImportCommand.value.sourceKey,
      expectedRevision: 0
    }, {
      idempotencyKey: localImportCommand.value.draftKey,
      expectedRevision: 0,
      wageMonth: localImportPreview.value.wageMonth,
      sourceTotalCents: sourceTotalCents(lines),
      personLines: lines
    });
    localApprovedSource.value = null;
    localImportPreview.value = null;
    localImportCommand.value = null;
    await loadWorkbench();
  } catch (error) {
    importError.value = formatUnknownApiError(error, "创建工资承担草稿失败");
  } finally {
    importLoading.value = false;
  }
}

async function createImportedDraftWithCapability(
  sourceBody: Parameters<typeof createApprovedWageSource>[0],
  draftBody: Omit<Parameters<typeof createWageStatementDraft>[0], "sourceVersionId">
) {
  const capability = await fetchWageStatementCapabilities();
  const operationAllowed = capability.canPrepare;
  if (!operationAllowed) throw new Error("当前账号无权导入外部批准工资资料并创建草稿");
  const source = await createApprovedWageSource(sourceBody);
  return createWageStatementDraft({ ...draftBody, sourceVersionId: source.id });
}

async function loadWorkbench() {
  loading.value = true;
  loadError.value = "";
  try {
    const workbench = await fetchWageStatementWorkbench();
    rows.value = workbench.items;
    capabilities.value = workbench.capabilities;
  } catch (error) {
    rows.value = [];
    capabilities.value = { ...noCapabilities };
    loadError.value = formatUnknownApiError(error, "加载月度工资承担工作台失败");
  } finally {
    loading.value = false;
  }
}

async function openDetail(row: WageStatementWorkbenchItem) {
  selected.value = row;
  await refreshSelectedDetail();
}

async function refreshSelectedDetail() {
  if (!selected.value) return;
  detailLoading.value = true;
  detailError.value = "";
  summary.value = null;
  importPreview.value = null;
  try {
    const [loadedSummary, loadedPreview] = await Promise.all([
      fetchWageStatementSummary(selected.value.statementId),
      fetchWageStatementImportPreview(selected.value.statementId)
    ]);
    summary.value = loadedSummary;
    importPreview.value = loadedPreview;
  } catch (error) {
    detailError.value = formatUnknownApiError(error, "加载工资月度汇总详情失败");
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  selected.value = null;
  summary.value = null;
  importPreview.value = null;
  detailError.value = "";
  returnDialogVisible.value = false;
  returnReason.value = "";
}

async function runCommand(action: "submit" | "confirm") {
  if (!selected.value || !summary.value || commandLoading.value) return;
  const allowed = action === "submit" ? canSubmitSelected.value : canConfirmSelected.value;
  if (!allowed) return;
  const statementId = selected.value.statementId;
  const revision = summary.value.revision;
  const commandKey = commandKeyFor(statementId, action, revision);
  commandLoading.value = true;
  detailError.value = "";
  try {
    const body = { idempotencyKey: idempotencyKeyFor(commandKey), expectedRevision: revision };
    if (action === "submit") await submitWageStatementWithCapability(statementId, body);
    else await confirmWageStatementWithCapability(statementId, body);
    pendingCommandKeys.delete(commandKey);
    await loadWorkbench();
    await refreshSelectedDetail();
  } catch (error) {
    if (isKnownBusinessRejection(error)) pendingCommandKeys.delete(commandKey);
    detailError.value = formatUnknownApiError(error, action === "submit" ? "提交工资承担单失败" : "确认工资承担单失败");
  } finally { commandLoading.value = false; }
}

async function submitReturn() {
  if (!selected.value || !summary.value || !canReturnSelected.value || commandLoading.value) return;
  const reason = returnReason.value.trim();
  if (!reason) { detailError.value = "请填写退回原因。"; return; }
  const statementId = selected.value.statementId;
  const revision = summary.value.revision;
  const commandKey = commandKeyFor(statementId, "return", revision, reason);
  commandLoading.value = true;
  detailError.value = "";
  try {
    await returnWageStatementWithCapability(statementId, { idempotencyKey: idempotencyKeyFor(commandKey), expectedRevision: revision, reason });
    pendingCommandKeys.delete(commandKey);
    returnDialogVisible.value = false;
    returnReason.value = "";
    await loadWorkbench();
    await refreshSelectedDetail();
  } catch (error) {
    if (isKnownBusinessRejection(error)) pendingCommandKeys.delete(commandKey);
    detailError.value = formatUnknownApiError(error, "退回工资承担单失败");
  } finally { commandLoading.value = false; }
}

async function submitWageStatementWithCapability(
  statementId: string,
  body: Parameters<typeof submitWageStatement>[1]
) {
  const capability = await fetchWageStatementCapabilities();
  const operationAllowed = capability.canSubmit;
  if (!operationAllowed) throw new Error("当前账号无权提交工资承担单");
  return submitWageStatement(statementId, body);
}

async function returnWageStatementWithCapability(
  statementId: string,
  body: Parameters<typeof returnWageStatement>[1]
) {
  const capability = await fetchWageStatementCapabilities();
  const operationAllowed = capability.canReturn;
  if (!operationAllowed) throw new Error("当前账号无权退回工资承担单");
  return returnWageStatement(statementId, body);
}

async function confirmWageStatementWithCapability(
  statementId: string,
  body: Parameters<typeof confirmWageStatement>[1]
) {
  const capability = await fetchWageStatementCapabilities();
  const operationAllowed = capability.canConfirm;
  if (!operationAllowed) throw new Error("当前账号无权确认工资承担单");
  return confirmWageStatement(statementId, body);
}

onMounted(() => void loadWorkbench());
</script>

<template>
  <JgWorkbenchShell
    class="wage-statement-workbench"
    title="月度工资承担工作台"
    description="统一查看我方项目管理人员工资承担的月度进度、岗位汇总和来源导入状态。本页仅显示非敏感汇总信息。"
  >
    <template #actions>
      <t-button variant="outline" :loading="loading" @click="loadWorkbench">刷新数据</t-button>
    </template>

    <t-card v-if="canImportApprovedSource" class="wage-statement-workbench__import" title="导入外部批准工资资料" :bordered="true">
      <p class="wage-statement-workbench__import-note">
        仅选择已获批准的 JSON 资料。文件内容仅在本次浏览器内存中用于生成脱敏预览，并在确认后直接提交受控服务端；本页不会展示人员、金额或证据明细。
      </p>
      <label class="wage-statement-workbench__file-select">
        <span>选择外部批准工资资料</span>
        <!-- ui-rules-ignore: native-file-input - 浏览器仅为用户明确选择的本地资料提供受控读取入口。 -->
        <input type="file" accept="application/json" @change="readApprovedSourceFile" />
      </label>
      <template v-if="localImportPreview">
        <h3 class="wage-statement-workbench__section-title">本次导入预览</h3>
        <t-descriptions bordered :column="1">
          <t-descriptions-item label="承担公司">{{ localImportPreview.employmentCompanyLabel }}</t-descriptions-item>
          <t-descriptions-item label="工资月份">{{ localImportPreview.wageMonth }}</t-descriptions-item>
          <t-descriptions-item label="来源版本">{{ localImportPreview.sourceLabel }}</t-descriptions-item>
          <t-descriptions-item label="人员记录数">{{ localImportPreview.personLineCount }}</t-descriptions-item>
          <t-descriptions-item label="岗位类别数">{{ localImportPreview.positionCategoryCount }}</t-descriptions-item>
          <t-descriptions-item label="项目分配记录数">{{ localImportPreview.projectAllocationCount }}</t-descriptions-item>
        </t-descriptions>
        <t-button class="wage-statement-workbench__create-draft" theme="primary" :loading="importLoading" @click="createImportedDraft">
          创建工资承担草稿
        </t-button>
      </template>
      <t-alert v-if="importError" class="wage-statement-workbench__notice" theme="error" :message="importError" />
    </t-card>

    <JgResultState
      :loading="loading"
      :has-results="rows.length > 0"
      :error="loadError"
      empty-title="当前暂无月度工资承担记录"
      empty-description="工资承担单创建、提交和确认仍在受控业务流程中办理。"
      @retry="loadWorkbench"
    >
      <t-card class="jg-table-region jg-table-region--wide" :bordered="true">
        <t-table
          row-key="statementId"
          size="small"
          table-layout="fixed"
          :columns="columns"
          :data="rows"
          :loading="loading"
          :scroll="{ x: 1420 }"
          horizontal-scroll-affixed-bottom
        >
          <template #status="{ row }">
            <JgStatusTag :label="row.statusLabel" :tone="statusTone(row.status)" />
          </template>
          <template #updatedAt="{ row }">{{ dateTime(row.updatedAt) }}</template>
          <template #actions="{ row }">
            <t-link theme="primary" @click="openDetail(row)">查看汇总</t-link>
          </template>
        </t-table>
      </t-card>
    </JgResultState>

    <t-drawer
      v-model:visible="drawerVisible"
      header="月度汇总详情"
      size="560px"
      :footer="false"
      @close="closeDetail"
    >
      <JgResultState
        :loading="detailLoading"
        :has-results="Boolean(summary && importPreview)"
        :error="detailError"
        empty-title="暂无可展示的汇总"
        empty-description="请返回工作台刷新后重试。"
        @retry="selected && openDetail(selected)"
      >
        <template v-if="summary && importPreview">
          <t-descriptions bordered :column="1">
            <t-descriptions-item label="承担公司">{{ summary.employmentCompanyName }}</t-descriptions-item>
            <t-descriptions-item label="工资月份">{{ summary.wageMonth }}</t-descriptions-item>
            <t-descriptions-item label="当前状态">{{ summary.statusLabel }}</t-descriptions-item>
            <t-descriptions-item label="当前修订">第 {{ summary.revision }} 版</t-descriptions-item>
            <t-descriptions-item label="来源版本">{{ summary.sourceLabel }}</t-descriptions-item>
            <t-descriptions-item label="人员记录数">{{ summary.personLineCount }}</t-descriptions-item>
            <t-descriptions-item label="岗位类别数">{{ summary.positionCategoryCount }}</t-descriptions-item>
            <t-descriptions-item label="项目分配记录数">{{ summary.projectAllocationCount }}</t-descriptions-item>
          </t-descriptions>
          <t-alert
            v-if="summary.latestReviewReturn"
            class="wage-statement-workbench__notice"
            theme="warning"
            :message="`第 ${summary.latestReviewReturn.revision} 版已退回，当前草稿可修订后重新提交。`"
          />

          <h3 class="wage-statement-workbench__section-title">岗位汇总</h3>
          <t-table
            row-key="positionCategoryLabel"
            size="small"
            :columns="categoryColumns"
            :data="summary.categories"
          />

          <h3 class="wage-statement-workbench__section-title">来源导入预览</h3>
          <t-descriptions bordered :column="1">
            <t-descriptions-item label="来源版本">{{ importPreview.sourceLabel }}</t-descriptions-item>
            <t-descriptions-item label="导入状态">{{ importPreview.sourceStatusLabel }}</t-descriptions-item>
            <t-descriptions-item label="人员记录数">{{ importPreview.personLineCount }}</t-descriptions-item>
            <t-descriptions-item label="岗位类别数">{{ importPreview.positionCategoryCount }}</t-descriptions-item>
            <t-descriptions-item label="项目分配记录数">{{ importPreview.projectAllocationCount }}</t-descriptions-item>
          </t-descriptions>

          <t-alert v-if="detailError" class="wage-statement-workbench__notice" theme="error" :message="detailError" />
          <t-space class="wage-statement-workbench__commands">
            <t-button v-if="canSubmitSelected" :loading="commandLoading" @click="runCommand('submit')">提交</t-button>
            <t-button v-if="canReturnSelected" theme="warning" variant="outline" :loading="commandLoading" @click="returnDialogVisible = true">退回</t-button>
            <t-button v-if="canConfirmSelected" theme="success" :loading="commandLoading" @click="runCommand('confirm')">确认</t-button>
          </t-space>
        </template>
      </JgResultState>
    </t-drawer>

    <t-dialog
      v-model:visible="returnDialogVisible"
      header="退回工资承担单"
      :confirm-btn="{ content: '确认退回', loading: commandLoading }"
      @confirm="submitReturn"
    >
      <t-textarea v-model="returnReason" :maxlength="500" placeholder="请填写退回原因" />
    </t-dialog>
  </JgWorkbenchShell>
</template>

<style scoped>
.wage-statement-workbench__section-title {
  margin: 24px 0 12px;
  color: var(--jg-text-primary);
  font-size: 16px;
}

.wage-statement-workbench__notice { margin-top: 16px; }
.wage-statement-workbench__commands { margin-top: 20px; }
.wage-statement-workbench__import { margin-bottom: 16px; }
.wage-statement-workbench__import-note { margin: 0 0 16px; color: var(--jg-text-secondary); }
.wage-statement-workbench__file-select { display: inline-flex; align-items: center; gap: 12px; color: var(--jg-text-primary); }
.wage-statement-workbench__create-draft { margin-top: 16px; }
</style>
