<script setup lang="ts">
import type {
  ContractInvoiceType,
  ContractTaxFactSource,
  ContractTaxMode,
  RoleKey
} from "@jiangkong/shared-domain";
import type { UploadFile } from "tdesign-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  confirmContractTaxFactRevision,
  createContractTaxFactRevision,
  fetchContractTaxFactRevisions,
  reviewContractTaxFactRevisionByFinance,
  submitContractTaxFactRevisionForFinanceReview,
  updateContractTaxFactRevision,
  type ContractTaxFactCurrentReadModel,
  type ContractTaxFactRevisionListReadModel,
  type ContractTaxFactRevisionReadModel
} from "../../../api/contract-tax-facts.api";
import { uploadPrivateFile } from "../../../api/core-flow-read.api";
import {
  invoiceTypeOptions,
  taxFactSourceOptions,
  taxModeOptions
} from "../contract-takeover.config";
import {
  buildContractTaxFactReviewState,
  createContractTaxFactDraft,
  normalizeContractTaxFactDraft,
  revisionStatusLabel,
  taxFactSubmissionDisabledReason,
  type ContractTaxFactDraft
} from "../contract-tax-fact-review.state";

const props = defineProps<{
  projectId: string;
  takeoverId: string;
  contractNo: string;
  currentFacts: ContractTaxFactCurrentReadModel;
  missingFields: string[];
  userId: string;
  roleKeys: RoleKey[];
}>();

const emit = defineEmits<{
  changed: [];
  "go-contract-change": [contractId: string];
}>();

const data = ref<ContractTaxFactRevisionListReadModel | null>(null);
const loading = ref(false);
const busyAction = ref("");
const message = ref("");
const messageTone = ref<"success" | "error" | "info">("info");
const editing = ref(false);
const uploadFiles = ref<UploadFile[]>([]);
const draft = reactive<ContractTaxFactDraft>(
  createContractTaxFactDraft(props.currentFacts, null)
);
const reviewVisible = ref(false);
const reviewStage = ref<"finance" | "contract">("finance");
const reviewDecision = ref<"approve" | "reject">("approve");
const reviewComment = ref("");

const effectiveData = computed<ContractTaxFactRevisionListReadModel>(() =>
  data.value ?? { contractId: "", current: props.currentFacts, rows: [], revisions: [] }
);
const currentRowById = computed(
  () => new Map(effectiveData.value.rows.map((row) => [row.contractBillRowId, row]))
);
const state = computed(() =>
  buildContractTaxFactReviewState({
    data: effectiveData.value,
    missingFields: props.missingFields,
    userId: props.userId,
    roleKeys: props.roleKeys
  })
);
const activeRevision = computed(() => state.value.activeRevision);
const submissionDisabledReason = computed(() => taxFactSubmissionDisabledReason(draft));
const selectedEvidenceFile = computed(() => {
  const raw = uploadFiles.value[0]?.raw;
  return raw instanceof File ? raw : null;
});
const currentFactItems = computed(() => [
  {
    label: "当前状态",
    value: currentStatusLabel(effectiveData.value.current.status)
  },
  {
    label: "发票类型",
    value: invoiceTypeText(effectiveData.value.current.invoiceType)
  },
  {
    label: "计税模式",
    value: taxModeText(effectiveData.value.current.taxMode)
  },
  {
    label: "默认税率",
    value: effectiveData.value.current.defaultTaxRatePercent
      ? `${effectiveData.value.current.defaultTaxRatePercent}%`
      : "原合同未明确"
  },
  {
    label: "事实来源",
    value: sourceText(effectiveData.value.current.source)
  },
  {
    label: "确认说明",
    value: effectiveData.value.current.confirmationExplanation || "—"
  },
  {
    label: "已确认版本",
    value: `第 ${effectiveData.value.current.revision} 版`
  }
]);

onMounted(load);
watch(
  () => [props.projectId, props.takeoverId],
  () => {
    data.value = null;
    editing.value = false;
    load();
  }
);
watch(
  () => props.roleKeys.join(","),
  () => {
    if (state.value.canRead && !data.value && !loading.value) load();
  }
);
watch(
  () => props.currentFacts,
  (current) => {
    if (!data.value && !editing.value) resetDraft(current, null);
  },
  { deep: true }
);
watch(
  () => draft.taxMode,
  (taxMode) => {
    if (taxMode !== "single_rate") return;
    for (const row of draft.rowFacts) {
      row.taxRatePercentOverride = "";
    }
  }
);

async function load() {
  if (!state.value.canRead) return;
  loading.value = true;
  message.value = "";
  try {
    data.value = await fetchContractTaxFactRevisions(props.projectId, props.takeoverId);
    const active = data.value.revisions.find((revision) =>
      ["draft", "pending_finance_review", "pending_contract_confirmation"].includes(
        revision.status
      )
    );
    if (
      active?.status === "draft" &&
      active.createdByUserId === props.userId &&
      state.value.canEdit
    ) {
      resetDraft(data.value.current, active);
      editing.value = true;
    } else {
      editing.value = false;
    }
  } catch (error) {
    setMessage(
      error instanceof Error ? `${error.message}。当前事实仍可查看，请稍后重试。` : "读取修订记录失败，请稍后重试。",
      "error"
    );
  } finally {
    loading.value = false;
  }
}

function startDraft() {
  if (!state.value.canCreate) {
    setMessage("当前岗位不能新建税务事实修订", "error");
    return;
  }
  resetDraft(effectiveData.value.current, null);
  draft.kind = state.value.createKind;
  editing.value = true;
  uploadFiles.value = [];
  message.value = "";
}

function cancelDraft() {
  editing.value = false;
  uploadFiles.value = [];
  const active = activeRevision.value;
  resetDraft(
    effectiveData.value.current,
    active?.status === "draft" && active.createdByUserId === props.userId ? active : null
  );
}

async function saveDraft() {
  if (!state.value.canEdit && !state.value.canCreate) {
    setMessage("当前岗位不能保存税务事实修订", "error");
    return;
  }
  return runAction("save", async () => {
    const payload = await prepareDraftPayload();
    const active = activeRevision.value;
    const saved =
      active?.status === "draft"
        ? await updateContractTaxFactRevision(
            props.projectId,
            props.takeoverId,
            active.id,
            payload
          )
        : await createContractTaxFactRevision(props.projectId, props.takeoverId, payload);
    await reloadAfterAction("税务事实修订草稿已保存");
    return saved;
  });
}

async function submitFinanceReview() {
  if (!state.value.canSubmitFinance && !state.value.canCreate) {
    setMessage("当前岗位不能提交税务事实财务复核", "error");
    return;
  }
  if (submissionDisabledReason.value) {
    setMessage(submissionDisabledReason.value, "error");
    return;
  }
  await runAction("submit", async () => {
    const saved = await saveDraftWithoutMessage();
    await submitContractTaxFactRevisionForFinanceReview(
      props.projectId,
      props.takeoverId,
      saved.id
    );
    editing.value = false;
    await reloadAfterAction("已提交财务主管复核");
  });
}

function openReview(stage: "finance" | "contract") {
  if (
    (stage === "finance" && !state.value.canFinanceReview) ||
    (stage === "contract" && !state.value.canContractConfirm)
  ) {
    setMessage("当前岗位不能处理该税务事实复核节点", "error");
    return;
  }
  reviewStage.value = stage;
  reviewDecision.value = "approve";
  reviewComment.value = "";
  reviewVisible.value = true;
}

async function submitReviewDecision() {
  const active = activeRevision.value;
  if (!active) return;
  if (reviewDecision.value === "reject" && !reviewComment.value.trim()) {
    setMessage("退回时请填写具体原因，便于合同员下一步补正", "error");
    return;
  }
  await runAction("review", async () => {
    const body = {
      decision: reviewDecision.value,
      comment: reviewComment.value.trim() || undefined
    };
    if (reviewStage.value === "finance") {
      await reviewContractTaxFactRevisionByFinance(
        props.projectId,
        props.takeoverId,
        active.id,
        body
      );
    } else {
      await confirmContractTaxFactRevision(
        props.projectId,
        props.takeoverId,
        active.id,
        body
      );
    }
    reviewVisible.value = false;
    await reloadAfterAction(
      reviewDecision.value === "approve"
        ? reviewStage.value === "finance"
          ? "财务复核已通过，等待合同部主管确认"
          : "合同部已确认税务事实"
        : "已退回合同员补正"
    );
  });
}

async function saveDraftWithoutMessage(): Promise<ContractTaxFactRevisionReadModel> {
  const payload = await prepareDraftPayload();
  const active = activeRevision.value;
  return active?.status === "draft"
    ? updateContractTaxFactRevision(
        props.projectId,
        props.takeoverId,
        active.id,
        payload
      )
    : createContractTaxFactRevision(props.projectId, props.takeoverId, payload);
}

async function prepareDraftPayload() {
  const file = selectedEvidenceFile.value;
  if (file) {
    const uploaded = await uploadPrivateFile(file, file.name);
    draft.evidenceFileId = uploaded.id;
  }
  return normalizeContractTaxFactDraft(draft);
}

async function reloadAfterAction(successMessage: string) {
  uploadFiles.value = [];
  data.value = await fetchContractTaxFactRevisions(props.projectId, props.takeoverId);
  setMessage(successMessage, "success");
  emit("changed");
}

async function runAction<T>(key: string, action: () => Promise<T>): Promise<T | undefined> {
  busyAction.value = key;
  message.value = "";
  try {
    return await action();
  } catch (error) {
    setMessage(
      error instanceof Error
        ? `${error.message}。已保留当前填写内容，请核对后重试。`
        : "操作未完成，已保留当前填写内容，请稍后重试。",
      "error"
    );
    return undefined;
  } finally {
    busyAction.value = "";
  }
}

function resetDraft(
  current: ContractTaxFactCurrentReadModel,
  revision: ContractTaxFactRevisionReadModel | null
) {
  Object.assign(
    draft,
    createContractTaxFactDraft(current, revision, effectiveData.value.rows)
  );
}

function setMessage(text: string, tone: "success" | "error" | "info") {
  message.value = text;
  messageTone.value = tone;
}

function invoiceTypeText(value: ContractInvoiceType | null) {
  if (!value) return "原合同未明确";
  return value === "vat_special" ? "增值税专用发票" : "增值税普通发票";
}

function taxModeText(value: ContractTaxMode) {
  return value === "multiple_rate" ? "特殊多税率" : "单一税率";
}

function sourceText(value: ContractTaxFactSource | null) {
  return taxFactSourceOptions.find((option) => option.value === value)?.label ?? "—";
}

function currentStatusLabel(value: string) {
  const labels: Record<string, string> = {
    unconfirmed: "未明确",
    draft: "草稿",
    frozen: "随审批冻结",
    pending_finance_review: "待财务复核",
    pending_contract_confirmation: "待合同部确认",
    confirmed: "已确认"
  };
  return labels[value] ?? "—";
}
</script>

<template>
  <section class="tax-review-panel">
    <div class="tax-review-heading">
      <div>
        <h3>税务事实补录与复核</h3>
        <p>{{ contractNo }} · 补录遗漏事实或纠正录入错误，不能替代合同变更。</p>
      </div>
      <t-space>
        <t-button
          v-if="state.canRead"
          variant="outline"
          :loading="loading"
          @click="load"
        >
          刷新修订记录
        </t-button>
        <t-button
          v-if="state.canGoContractChange"
          variant="outline"
          :disabled="!effectiveData.contractId"
          @click="emit('go-contract-change', effectiveData.contractId)"
        >
          前往合同变更
        </t-button>
      </t-space>
    </div>

    <t-alert
      theme="info"
      title="业务边界"
      :message="state.agreementChangeText"
    />

    <t-alert
      v-if="message"
      :theme="messageTone"
      :title="messageTone === 'error' ? '操作未完成' : '处理结果'"
      :message="message"
    />

    <div class="current-facts">
      <div
        v-for="item in currentFactItems"
        :key="item.label"
      >
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </div>
    </div>

    <div class="release-condition">
      <strong>当前缺口</strong>
      <p>{{ state.gapText }}</p>
      <strong>结算解除条件</strong>
      <p>{{ state.settlementReleaseText }}</p>
    </div>

    <t-alert
      v-if="!state.canRead"
      theme="warning"
      title="当前岗位只可查看合同事实"
      message="当前岗位不能读取税务事实修订记录；技术管理员不代办业务节点。"
    />

    <template v-else>
      <div
        v-if="activeRevision"
        class="active-revision"
      >
        <div class="active-revision-head">
          <div>
            <strong>
              第 {{ activeRevision.revisionNo }} 次{{ activeRevision.kind === "correction" ? "更正" : "补录" }}
            </strong>
            <span>{{ revisionStatusLabel(activeRevision.status) }}</span>
          </div>
          <t-space>
            <t-button
              v-if="state.canFinanceReview"
              theme="primary"
              @click="openReview('finance')"
            >
              财务复核
            </t-button>
            <t-button
              v-if="state.canContractConfirm"
              theme="primary"
              @click="openReview('contract')"
            >
              合同部确认
            </t-button>
          </t-space>
        </div>
        <dl class="revision-facts">
          <div>
            <dt>发票类型</dt>
            <dd>{{ invoiceTypeText(activeRevision.invoiceType) }}</dd>
          </div>
          <div>
            <dt>计税模式</dt>
            <dd>{{ taxModeText(activeRevision.taxMode || "single_rate") }}</dd>
          </div>
          <div>
            <dt>默认税率</dt>
            <dd>{{ activeRevision.defaultTaxRatePercent ? `${activeRevision.defaultTaxRatePercent}%` : "—" }}</dd>
          </div>
          <div>
            <dt>事实来源</dt>
            <dd>{{ sourceText(activeRevision.source) }}</dd>
          </div>
          <div>
            <dt>确认说明</dt>
            <dd>{{ activeRevision.confirmationExplanation || "—" }}</dd>
          </div>
          <div>
            <dt>清单价格事实</dt>
            <dd>{{ activeRevision.rowFacts.length }} 条</dd>
          </div>
        </dl>
        <div
          v-if="activeRevision.financeReviewComment || activeRevision.contractReviewComment"
          class="review-comments"
        >
          <p v-if="activeRevision.financeReviewComment">
            财务意见：{{ activeRevision.financeReviewComment }}
          </p>
          <p v-if="activeRevision.contractReviewComment">
            合同部意见：{{ activeRevision.contractReviewComment }}
          </p>
        </div>
      </div>

      <div
        v-if="editing && (state.canEdit || state.canCreate)"
        class="revision-editor"
      >
        <div class="editor-heading">
          <div>
            <strong>{{ draft.kind === "correction" ? "纠正已确认事实" : "补录缺失事实" }}</strong>
            <p>税率最多保留 2 位小数；未上传依据附件时必须填写确认说明。</p>
          </div>
        </div>
        <div class="editor-grid">
          <label>
            <span>发票类型</span>
            <t-select
              v-model="draft.invoiceType"
              :options="invoiceTypeOptions"
              placeholder="请选择发票类型"
            />
          </label>
          <label>
            <span>计税模式</span>
            <t-select
              v-model="draft.taxMode"
              :options="taxModeOptions"
            />
          </label>
          <label>
            <span>默认税率（%）</span>
            <t-input
              v-model="draft.defaultTaxRatePercent"
              placeholder="如 13.00"
            />
          </label>
          <label>
            <span>事实来源</span>
            <t-select
              v-model="draft.source"
              :options="taxFactSourceOptions"
              placeholder="请选择事实来源"
            />
          </label>
          <label class="wide-field">
            <span>确认说明</span>
            <t-textarea
              v-model="draft.confirmationExplanation"
              placeholder="说明发票类型、税率和依据的核对过程"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label
            v-if="draft.kind === 'correction'"
            class="wide-field"
          >
            <span>更正原因</span>
            <t-textarea
              v-model="draft.correctionReason"
              placeholder="只说明原录入错误及纠正依据；双方约定变化请走合同变更"
              :autosize="{ minRows: 2, maxRows: 4 }"
            />
          </label>
          <label class="wide-field">
            <span>依据附件（可选）</span>
            <t-upload
              v-model="uploadFiles"
              theme="file-input"
              :auto-upload="false"
              :max="1"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx"
              placeholder="选择合同页、补充资料或复核依据"
            />
            <small v-if="draft.evidenceFileId && !selectedEvidenceFile">已关联现有依据附件</small>
          </label>
        </div>
        <div
          v-if="draft.rowFacts.length"
          class="row-fact-editor"
        >
          <div class="row-fact-heading">
            <div>
              <strong>清单含税计价事实</strong>
              <p>仅补录原合同已经约定的含税单价；特殊多税率时才填写行级税率。</p>
            </div>
            <span>{{ draft.rowFacts.length }} 项</span>
          </div>
          <div class="row-fact-list">
            <div
              v-for="(row, index) in draft.rowFacts"
              :key="row.contractBillRowId"
              class="row-fact-item"
            >
              <div class="row-fact-meta">
                <strong>
                  {{ currentRowById.get(row.contractBillRowId)?.itemName || `清单项目 ${index + 1}` }}
                </strong>
                <span>
                  {{ currentRowById.get(row.contractBillRowId)?.billName || "合同清单" }}
                  ·
                  {{ currentRowById.get(row.contractBillRowId)?.specification || "无规格" }}
                  ·
                  {{ currentRowById.get(row.contractBillRowId)?.unit || "未明确单位" }}
                </span>
              </div>
              <label>
                <span>含税单价（元）</span>
                <t-input
                  v-model="row.taxInclusiveUnitPrice"
                  placeholder="原合同未明确时可留空"
                />
              </label>
              <label>
                <span>行级税率（%）</span>
                <t-input
                  v-model="row.taxRatePercentOverride"
                  :disabled="draft.taxMode !== 'multiple_rate'"
                  :placeholder="draft.taxMode === 'multiple_rate' ? '如 9.00' : '继承默认税率'"
                />
              </label>
            </div>
          </div>
        </div>
        <div class="editor-actions">
          <t-button
            variant="outline"
            :loading="busyAction === 'save'"
            @click="saveDraft"
          >
            保存草稿
          </t-button>
          <t-tooltip
            v-if="submissionDisabledReason"
            :content="submissionDisabledReason"
          >
            <t-button disabled>
              提交财务复核
            </t-button>
          </t-tooltip>
          <t-button
            v-else-if="state.canSubmitFinance || !activeRevision"
            theme="primary"
            :loading="busyAction === 'submit'"
            @click="submitFinanceReview"
          >
            提交财务复核
          </t-button>
          <t-button
            variant="text"
            @click="cancelDraft"
          >
            取消
          </t-button>
        </div>
      </div>

      <div
        v-else-if="state.canCreate"
        class="create-action"
      >
        <t-button
          theme="primary"
          variant="outline"
          @click="startDraft"
        >
          {{ state.createKind === "correction" ? "发起录入更正" : "补录税务事实" }}
        </t-button>
      </div>

      <div class="revision-timeline">
        <h4>修订时间线</h4>
        <t-timeline v-if="state.timeline.length">
          <t-timeline-item
            v-for="item in state.timeline"
            :key="item.id"
            :label="item.updatedAt"
          >
            <div class="timeline-item">
              <strong>{{ item.title }} · {{ item.status }}</strong>
              <p>{{ item.summary }}</p>
              <p
                v-for="comment in item.comments"
                :key="comment"
              >
                {{ comment }}
              </p>
            </div>
          </t-timeline-item>
        </t-timeline>
        <p
          v-else
          class="empty-timeline"
        >
          暂无修订记录。
        </p>
      </div>
    </template>

    <t-dialog
      v-model:visible="reviewVisible"
      :header="reviewStage === 'finance' ? '财务复核税务事实' : '合同部确认税务事实'"
      :confirm-btn="{ content: '确认提交', loading: busyAction === 'review' }"
      cancel-btn="取消"
      :close-on-overlay-click="false"
      @confirm="submitReviewDecision"
    >
      <div class="review-dialog">
        <t-radio-group v-model="reviewDecision">
          <t-radio value="approve">
            通过
          </t-radio>
          <t-radio value="reject">
            退回补正
          </t-radio>
        </t-radio-group>
        <label>
          <span>复核意见{{ reviewDecision === "reject" ? "（必填）" : "（可选）" }}</span>
          <t-textarea
            v-model="reviewComment"
            placeholder="说明核对结论；退回时请写清缺什么、为什么、下一步怎么补"
            :autosize="{ minRows: 3, maxRows: 6 }"
          />
        </label>
      </div>
    </t-dialog>
  </section>
</template>

<style scoped>
.tax-review-panel {
  display: grid;
  gap: var(--jg-space-md);
  padding: var(--jg-space-md) 0;
  border-top: 1px solid var(--jg-color-border);
}

.tax-review-heading,
.active-revision-head,
.editor-heading {
  display: flex;
  justify-content: space-between;
  gap: var(--jg-space-md);
  align-items: flex-start;
}

.tax-review-heading h3,
.revision-timeline h4 {
  margin: 0;
}

.tax-review-heading p,
.editor-heading p,
.timeline-item p,
.release-condition p,
.review-comments p,
.empty-timeline {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-color-text-secondary);
  line-height: 1.6;
}

.current-facts,
.revision-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-block: 1px solid var(--jg-color-border);
}

.current-facts > div,
.revision-facts > div {
  min-width: 0;
  padding: var(--jg-space-sm) var(--jg-space-md);
  border-right: 1px solid var(--jg-color-border);
}

.current-facts > div:nth-child(4n),
.revision-facts > div:nth-child(4n) {
  border-right: 0;
}

.current-facts span,
.revision-facts dt,
.editor-grid label > span,
.review-dialog label > span {
  display: block;
  margin-bottom: var(--jg-space-xs);
  color: var(--jg-color-text-secondary);
  font-size: 12px;
}

.current-facts strong,
.revision-facts dd {
  margin: 0;
  color: var(--jg-color-text-primary);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.release-condition,
.active-revision,
.revision-editor {
  display: grid;
  gap: var(--jg-space-sm);
  padding: var(--jg-space-md);
  border: 1px solid var(--jg-color-border);
}

.active-revision-head > div {
  display: grid;
  gap: var(--jg-space-xs);
}

.active-revision-head span {
  color: var(--jg-color-brand);
  font-size: 13px;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-md);
}

.row-fact-editor,
.row-fact-list {
  display: grid;
  gap: var(--jg-space-sm);
}

.row-fact-heading,
.row-fact-item {
  display: grid;
  gap: var(--jg-space-sm);
}

.row-fact-heading {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.row-fact-heading p,
.row-fact-meta span {
  margin: var(--jg-space-xs) 0 0;
  color: var(--jg-color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.row-fact-item {
  grid-template-columns: minmax(220px, 1.5fr) minmax(160px, 1fr) minmax(140px, 0.8fr);
  align-items: end;
  padding: var(--jg-space-sm) 0;
  border-top: 1px solid var(--jg-color-border);
}

.row-fact-item label > span {
  display: block;
  margin-bottom: var(--jg-space-xs);
  color: var(--jg-color-text-secondary);
  font-size: 12px;
}

.row-fact-meta {
  min-width: 0;
}

.row-fact-meta strong,
.row-fact-meta span {
  display: block;
  overflow-wrap: anywhere;
}

.wide-field {
  grid-column: 1 / -1;
}

.editor-actions,
.create-action {
  display: flex;
  justify-content: flex-end;
  gap: var(--jg-space-sm);
}

.timeline-item {
  padding-bottom: var(--jg-space-sm);
}

.review-dialog {
  display: grid;
  gap: var(--jg-space-md);
}

@container takeover-detail (max-width: 720px) {
  .tax-review-heading,
  .active-revision-head,
  .editor-heading {
    display: grid;
  }

  .current-facts,
  .revision-facts,
  .editor-grid,
  .row-fact-item {
    grid-template-columns: 1fr;
  }

  .current-facts > div,
  .revision-facts > div {
    border-right: 0;
    border-bottom: 1px solid var(--jg-color-border);
  }

  .wide-field {
    grid-column: auto;
  }
}
</style>
