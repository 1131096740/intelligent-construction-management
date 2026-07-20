<template>
  <section class="page jg-responsive-ledger">
    <div class="page-head">
      <div>
        <h1>标准条款库</h1>
        <p>当前只展示最新已发布条款；合同部创建后提交，合同主管可复核并发布</p>
      </div>
      <t-space class="jg-responsive-actions">
        <t-input
          v-model="category"
          placeholder="分类筛选，如 付款"
        />
        <t-button @click="loadClauses">
          查询
        </t-button>
      </t-space>
    </div>

    <t-card
      v-if="canMaintainTemplates"
      title="创建条款草稿"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid">
        <label><span>编码</span><t-input v-model="form.code" /></label>
        <label><span>分类</span><t-input v-model="form.category" /></label>
        <label><span>名称</span><t-input v-model="form.name" /></label>
        <label><span>标题</span><t-input v-model="form.title" /></label>
      </div>
      <t-textarea
        v-model="form.text"
        class="textarea"
        placeholder="条款正文"
      />
      <t-button
        theme="primary"
        :loading="creating"
        @click="createClause"
      >
        创建草稿
      </t-button>
    </t-card>

    <t-card
      v-if="canMaintainTemplates"
      title="提交版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid submit-grid">
        <label><span>标准条款版本编号</span><t-input v-model="submitForm.versionId" /></label>
        <t-button
          theme="primary"
          :disabled="!submitForm.versionId.trim()"
          @click="submitClause"
        >
          提交
        </t-button>
      </div>
    </t-card>

    <t-card
      v-if="canMaintainTemplates"
      title="草稿与版本历史"
      :bordered="true"
      class="panel jg-table-region jg-table-region--standard"
    >
      <t-table
        row-key="id"
        size="small"
        :columns="historyColumns"
        :data="historyVersions"
        :loading="loading"
        horizontal-scroll-affixed-bottom
        empty="暂无标准条款版本"
      >
        <template #version="{ row }">
          V{{ row.versionNo }}
        </template>
        <template #status="{ row }">
          <t-tag
            size="small"
            variant="light"
          >
            {{ clauseStatusLabel(row.status) }}
          </t-tag>
        </template>
        <template #updatedAt="{ row }">
          {{ formatDateTime(row.updatedAt) }}
        </template>
        <template #operation="{ row }">
          <t-link
            theme="primary"
            @click="selectHistoryVersion(row)"
          >
            治理版本
          </t-link>
        </template>
      </t-table>
      <div
        v-if="selectedHistoryVersion"
        class="selected-version-governance"
      >
        <strong>
          {{ selectedHistoryVersion.name }} · V{{ selectedHistoryVersion.versionNo }} ·
          {{ clauseStatusLabel(selectedHistoryVersion.status) }}
        </strong>
        <BusinessDraftAction
          :actions="selectedHistoryVersion.availableActions"
          :blocked-reasons="selectedHistoryVersion.blockedReasons"
          :subject="selectedActionSubject"
          :execute="discardSelectedClauseVersion"
          @completed="handleDiscardCompleted"
        />
      </div>
    </t-card>

    <t-card
      v-if="canPublishTemplates"
      title="发布版本"
      :bordered="true"
      class="panel"
    >
      <div class="form-grid publish-grid">
        <label><span>标准条款版本编号</span><t-input v-model="publishForm.versionId" /></label>
        <label><span>发布说明</span><t-input v-model="publishForm.changeSummary" /></label>
        <t-button
          theme="primary"
          :disabled="!publishForm.versionId.trim()"
          @click="publishClause"
        >
          发布
        </t-button>
      </div>
    </t-card>

    <t-card
      title="已发布条款"
      :bordered="true"
      class="panel jg-table-region jg-table-region--wide"
    >
      <t-table
        row-key="standardClauseVersionId"
        size="small"
        :columns="columns"
        :data="clauses"
        :loading="loading"
        horizontal-scroll-affixed-bottom
        empty="暂无已发布标准条款"
      >
        <template #versionNo="{ row }">
          v{{ row.versionNo }}
        </template>
        <template #content="{ row }">
          <pre class="preview">{{ clauseText(row.content) }}</pre>
        </template>
      </t-table>
      <p class="hint">
        版本历史/草稿列表后端暂未返回，本页不伪造历史数据。
      </p>
    </t-card>

    <p
      v-if="message"
      :class="['message', tone]"
    >
      {{ message }}
    </p>
    <SensitiveActionDialog
      v-model="leaveDialogVisible"
      title="放弃未保存的条款草稿？"
      description="继续后会丢弃尚未创建的条款编码、分类、名称、标题和正文。"
      confirm-text="放弃并离开"
      confirm-theme="danger"
      @confirm="resolveLeaveDecision(true)"
      @cancel="resolveLeaveDecision(false)"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  createStandardClause,
  discardStandardClauseVersion,
  listStandardClauseHistory,
  listPublishedStandardClauses,
  publishStandardClauseVersion,
  submitStandardClauseVersion,
  type PublishedStandardClause,
  type StandardClauseVersionReadModel
} from "../../api/contract-workbench.api";
import { useAuthStore } from "../../auth/auth.store";
import BusinessDraftAction, {
  type BusinessDraftActionRequest
} from "../../components/BusinessDraftAction.vue";
import SensitiveActionDialog from "../../components/SensitiveActionDialog.vue";
import { useUnsavedChangesGuard } from "../../lib/use-unsaved-changes-guard";
import {
  canMaintainContractTemplates,
  canPublishContractTemplates
} from "./template-permissions";

const columns = [
  { colKey: "category", title: "分类", width: 120 },
  { colKey: "code", title: "编码", width: 140 },
  { colKey: "name", title: "名称", minWidth: 160 },
  { colKey: "title", title: "标题", minWidth: 160 },
  { colKey: "versionNo", title: "版本", width: 80 },
  { colKey: "content", title: "只读正文", minWidth: 280 }
];
type StandardClauseHistoryRow = StandardClauseVersionReadModel & {
  code: string;
  category: string;
  name: string;
};
const historyColumns = [
  { colKey: "category", title: "分类", width: 120 },
  { colKey: "code", title: "编码", width: 140 },
  { colKey: "name", title: "名称", minWidth: 160 },
  { colKey: "title", title: "标题", minWidth: 180 },
  { colKey: "version", title: "版本", width: 80 },
  { colKey: "status", title: "状态", width: 100 },
  { colKey: "updatedAt", title: "更新时间", width: 180 },
  { colKey: "operation", title: "操作", width: 100, fixed: "right" as const }
];

const category = ref("");
const auth = useAuthStore();
const canMaintainTemplates = computed(() => canMaintainContractTemplates(auth.user?.roleKeys));
const canPublishTemplates = computed(() => canPublishContractTemplates(auth.user?.roleKeys));
const clauses = ref<PublishedStandardClause[]>([]);
const historyVersions = ref<StandardClauseHistoryRow[]>([]);
const selectedHistoryVersion = ref<StandardClauseHistoryRow | null>(null);
const loading = ref(false);
const creating = ref(false);
const message = ref("");
const tone = ref<"success" | "danger">("success");
const form = reactive({ code: "", category: "", name: "", title: "", text: "" });
const submitForm = reactive({ versionId: "" });
const publishForm = reactive({ versionId: "", changeSummary: "" });
const createBaseline = ref("");
const leaveDialogVisible = ref(false);
let resolvePendingLeave: ((decision: boolean) => void) | null = null;
const isDirty = computed(() => Boolean(createBaseline.value) && createSnapshot() !== createBaseline.value);
useUnsavedChangesGuard({
  isDirty,
  confirmLeave: () => new Promise<boolean>((resolve) => {
    resolvePendingLeave?.(false);
    resolvePendingLeave = resolve;
    leaveDialogVisible.value = true;
  })
});

function createSnapshot() {
  return JSON.stringify(form);
}

function syncCreateBaseline() {
  createBaseline.value = createSnapshot();
}

function resolveLeaveDecision(decision: boolean) {
  leaveDialogVisible.value = false;
  const resolve = resolvePendingLeave;
  resolvePendingLeave = null;
  resolve?.(decision);
}
const selectedActionSubject = computed(() => ({
  businessCode: selectedHistoryVersion.value?.code ?? "—",
  name: `${selectedHistoryVersion.value?.name ?? "标准条款"} V${selectedHistoryVersion.value?.versionNo ?? "—"}`,
  lastSavedAt: formatDateTime(selectedHistoryVersion.value?.updatedAt),
  impactScope: "仅废弃当前从未提交的条款草稿；已发布条款和合同引用不受影响。"
}));

async function loadClauses() {
  loading.value = true;
  try {
    clauses.value = await listPublishedStandardClauses(category.value.trim() || undefined);
    if (canMaintainTemplates.value) {
      const histories = await listStandardClauseHistory(category.value.trim() || undefined);
      historyVersions.value = histories.flatMap((clause) =>
        clause.versions.map((version) => ({
          ...version,
          code: clause.code,
          category: clause.category,
          name: clause.name
        }))
      );
      const selectedId = selectedHistoryVersion.value?.id;
      selectedHistoryVersion.value =
        historyVersions.value.find((version) => version.id === selectedId) ?? null;
    } else {
      historyVersions.value = [];
      selectedHistoryVersion.value = null;
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : "加载条款失败";
    tone.value = "danger";
  } finally {
    loading.value = false;
  }
}

async function createClause() {
  creating.value = true;
  try {
    const created = await createStandardClause({
      code: form.code.trim(),
      category: form.category.trim(),
      name: form.name.trim(),
      title: form.title.trim(),
      content: { text: form.text }
    });
    submitForm.versionId = String((created as { version?: { id?: string } }).version?.id ?? "");
    await loadClauses();
    selectedHistoryVersion.value =
      historyVersions.value.find((version) => version.id === submitForm.versionId) ?? null;
    Object.assign(form, { code: "", category: "", name: "", title: "", text: "" });
    syncCreateBaseline();
    message.value = "条款草稿已创建";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "创建条款失败";
    tone.value = "danger";
  } finally {
    creating.value = false;
  }
}

function selectHistoryVersion(version: StandardClauseHistoryRow) {
  selectedHistoryVersion.value = version;
  submitForm.versionId = version.status === "draft" ? version.id : "";
  publishForm.versionId = version.status === "submitted" ? version.id : "";
}

async function discardSelectedClauseVersion(request: BusinessDraftActionRequest) {
  const version = selectedHistoryVersion.value;
  if (!version || request.action !== "discard_version") {
    throw new Error("当前标准条款版本不支持该操作，请刷新后重试");
  }
  await discardStandardClauseVersion(version.id, {
    reason: request.reason,
    expectedUpdatedAt: version.updatedAt
  });
  await loadClauses();
}

function handleDiscardCompleted() {
  message.value = "条款草稿版本已废弃，已发布条款和正式引用均未改变";
  tone.value = "success";
}

function clauseStatusLabel(status: string) {
  return ({
    draft: "草稿",
    submitted: "待发布",
    published: "已发布",
    stopped: "已停用",
    revoked: "已撤销",
    discarded: "已废弃"
  } as Record<string, string>)[status] ?? "未知状态";
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("zh-CN", { hour12: false });
}

async function submitClause() {
  const versionId = submitForm.versionId.trim();
  if (!versionId) {
    message.value = "请先填写标准条款版本编号";
    tone.value = "danger";
    return;
  }
  try {
    await submitStandardClauseVersion(versionId);
    publishForm.versionId = versionId;
    message.value = "条款版本已提交";
    tone.value = "success";
  } catch (error) {
    message.value = error instanceof Error ? error.message : "提交失败";
    tone.value = "danger";
  }
}

async function publishClause() {
  const versionId = publishForm.versionId.trim();
  if (!versionId) {
    message.value = "请先填写标准条款版本编号";
    tone.value = "danger";
    return;
  }
  try {
    await publishStandardClauseVersion(versionId, {
      changeSummary: publishForm.changeSummary.trim() || "发布标准条款"
    });
    message.value = "条款版本已发布";
    tone.value = "success";
    await loadClauses();
  } catch (error) {
    message.value = error instanceof Error ? error.message : "发布失败";
    tone.value = "danger";
  }
}

onMounted(() => {
  syncCreateBaseline();
  void loadClauses();
});

function clauseText(content: unknown) {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return String(content ?? "");
  }
  const text = (content as { text?: unknown }).text;
  return typeof text === "string" ? text : "条款正文暂未按标准格式保存";
}
</script>

<style scoped>
.page { color: #151922; }
.page-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-head h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
.page-head p, label span, .hint { margin: 0; color: #767f8d; font-size: 12px; }
.panel { margin-bottom: 16px; border-radius: 3px; }
.form-grid { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; align-items: end; margin-bottom: 12px; }
.submit-grid { grid-template-columns: 1fr auto; }
.publish-grid { grid-template-columns: 1fr 1fr auto; }
label { display: grid; gap: 4px; }
.textarea { margin-bottom: 12px; }
.preview { max-height: 120px; overflow: auto; margin: 0; white-space: pre-wrap; }
.selected-version-governance { display: grid; gap: var(--jg-space-md); margin-top: var(--jg-space-md); }
.message { font-size: 12px; }
.success { color: #1b6b3a; }
.danger { color: #b51d2a; }
@container jg-page (max-width: 840px) { .page-head, .form-grid, .publish-grid { display: grid; grid-template-columns: 1fr; } }
</style>
