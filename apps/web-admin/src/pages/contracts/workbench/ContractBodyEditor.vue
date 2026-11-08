<template>
  <section class="body-editor" aria-labelledby="complete-body-title">
    <header class="body-editor-toolbar">
      <div>
        <h2 id="complete-body-title">完整合同正文</h2>
        <p>普通条款可直接修改；甲乙方、金额及清单资料请在填写信息中修改，保存后同步。</p>
      </div>
      <t-button :disabled="!canStartAddition" @click="openAddition">新增条款</t-button>
      <t-button
        variant="outline"
        :disabled="!canStartRegeneration"
        @click="openRegeneration"
      >
        重新生成正文
      </t-button>
      <t-button
        variant="outline"
        :disabled="!blankReviewContext || disabled || loading || saving || reviewDisabled"
        @click="requestBlankReview"
      >
        检查正文空位
      </t-button>
      <t-button
        v-if="paperMode === 'edit'"
        variant="outline"
        :disabled="!canOpenPaper"
        @click="openPaper"
      >
        A4纸面检查
      </t-button>
      <t-button
        v-else
        variant="outline"
        @click="paperMode = 'edit'"
      >
        适宽编辑
      </t-button>
      <t-button :disabled="disabled || !body || loading" :loading="saving" @click="emit('save')">保存正文</t-button>
    </header>
    <p v-if="error" class="body-editor-error" role="alert">{{ error }} <t-button variant="text" @click="readBody">重新读取</t-button></p>
    <p v-else-if="!layoutTemplateVersionId" class="body-editor-note">请先选择并保存合同模板，再查看完整正文。</p>
    <p v-else-if="loading && !body" class="body-editor-note" role="status">正在读取完整正文…</p>
    <section
      v-if="currentBodyWarnings.length"
      class="body-editor-note"
      role="status"
      aria-label="正文提示"
      aria-live="polite"
      aria-atomic="true"
    >
      <strong>正文提示</strong>
      <ul>
        <li
          v-for="message in currentBodyWarnings"
          :key="message"
        >
          {{ message }}
        </li>
      </ul>
    </section>
    <p v-if="additionNotice" class="body-editor-note" role="status">{{ additionNotice }}</p>
    <p
      v-if="blankReviewConfirmed"
      class="body-editor-note"
      role="status"
    >
      已检查当前版本，仍有{{ remainingBlankCount }}处待补充，可继续办理。
    </p>
    <p
      v-else-if="reviewDisabled && body"
      class="body-editor-note"
    >
      请先保存当前内容，再检查本次保存版本的正文空位。
    </p>
    <article
      v-if="body"
      v-show="paperMode === 'edit'"
      class="body-editor-paper"
      aria-label="合同正文适宽编辑"
    >
      <ContractBodyFlow
        :nodes="displayFlow"
        :blocks="displayBlocks"
        :paragraph-numbers="paragraphNumbers"
        :disabled="disabled"
        :removable-addition-ids="removableAdditionIds"
        :removable-source-ids="removableSourceIds"
        :anchored-source-ids="anchoredSourceIds"
        :deletion-disabled="loading || saving"
        :paragraph-moves="paragraphMoves"
        :moving-disabled="loading || saving"
        @edit="editParagraph"
        @edit-table="openTableEditor"
        @delete-addition="deleteAddedParagraph"
        @delete-source="deleteSourceParagraph"
        @move="moveParagraph"
      />
    </article>
    <ContractBodyPaperPreview
      v-if="paperMode === 'paper' && paperContext"
      :context="paperContext"
      :blocked="paperDisabled === true || saving"
    />
    <t-dialog
      v-model:visible="regenerationVisible"
      role="dialog"
      aria-label="重新生成正文"
      aria-modal="true"
      aria-describedby="body-regeneration-warning"
      header="重新生成正文"
      :footer="false"
      :close-on-overlay-click="false"
      width="min(640px, 94vw)"
      @close="cancelRegeneration"
    >
      <p id="body-regeneration-warning">
        重新生成会按当前填写资料重建正文，普通条款的手工修改和新增条款将被覆盖。已保存的手工正文会保留重建前检查点。
      </p>
      <p>取消会保留当前正文；确认后请核对保存回执。</p>
      <t-button
        variant="outline"
        @click="cancelRegeneration"
      >
        取消
      </t-button>
      <t-button
        :disabled="!canConfirmRegeneration"
        @click="confirmRegeneration"
      >
        确认重新生成
      </t-button>
    </t-dialog>
    <t-dialog v-model:visible="additionVisible" header="新增条款" :footer="false" width="min(640px, 94vw)">
      <p class="body-editor-note">选择普通段落后的插入位置。加入后会更新当前草稿，请以正文保存回执为准。</p>
      <label class="body-table-edit-label">
        <span>插入位置</span>
        <t-select v-model="additionAfter" :options="additionOptions" :disabled="disabled" aria-label="插入位置" />
      </label>
      <label class="body-table-edit-label">
        <span>新增条款内容</span>
        <t-textarea v-model="additionText" :readonly="disabled" :maxlength="20000" :autosize="{ minRows: 4, maxRows: 18 }" />
      </label>
      <t-button :disabled="!canStartAddition || !additionText.trim() || !additionOptions.some(option => option.value === additionAfter)" @click="addParagraph">加入正文</t-button>
    </t-dialog>
    <t-dialog v-model:visible="tableEditorVisible" header="编辑表格文字" :footer="false" width="min(640px, 94vw)">
      <p class="body-editor-note">修改会应用到当前草稿；请以正文保存回执为准。</p>
      <t-select v-model="tableParagraphId" :options="tableParagraphOptions" aria-label="选择表格段落" />
      <label v-if="selectedTableParagraph" class="body-table-edit-label">
        <span>编辑选中表格段落</span>
        <t-textarea :model-value="selectedTableParagraph.text" :readonly="disabled" :autosize="{ minRows: 4, maxRows: 18 }"
          @update:model-value="editParagraph(tableParagraphId, String($event))" />
      </label>
      <t-button @click="tableEditorVisible = false">完成编辑</t-button>
    </t-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { fetchContractDraftBody, type ContractBodyDeleteSavedAdditionContext, type ContractBodyEditPlan, type ContractBodyFlowNode, type ContractBodyParagraph, type ContractBodyUpdateContext, type ContractDraftBodyReadModel } from "../../../api/contract-workbench.api";
import { formatUnknownApiError } from "../../../api/error-message";
import ContractBodyFlow from "./ContractBodyFlow.vue";
import ContractBodyPaperPreview from "./ContractBodyPaperPreview.vue";

type BodyBlankReviewContext = {
  contractVersionId: string;
  draftRevision: number;
  documentContentRevision: number;
  layoutTemplateVersionId: string;
  sourceSha256: string;
  planJson: string;
  remaining: Array<{ positionId: string; number: number; labels: string[] }>;
};

const props = defineProps<{
  contractVersionId: string;
  draftRevision: number;
  layoutTemplateVersionId: string | null;
  editPlan: unknown;
  disabled: boolean;
  saving: boolean;
  reviewDisabled?: boolean;
  paperDisabled?: boolean;
  blankReviewReceipt?: BodyBlankReviewContext | null;
}>();
const emit = defineEmits<{
  (event: "update", plan: ContractBodyEditPlan, command?: ContractBodyUpdateContext): void;
  (event: "save"): void;
  (event: "review-blanks", context: BodyBlankReviewContext): void;
}>();
const body = ref<ContractDraftBodyReadModel | null>(null);
const loading = ref(false);
const error = ref("");
const currentBodyWarnings = computed(() => {
  const current = body.value;
  if (!current || loading.value || error.value || current.contractVersionId !== props.contractVersionId || current.draftRevision !== props.draftRevision || current.layoutTemplateVersionId !== props.layoutTemplateVersionId || !/^[a-f0-9]{64}$/u.test(current.sourceSha256)) return [];
  return current.warnings ?? [];
});
let requestId = 0;
const additionVisible = ref(false);
const additionAfter = ref("");
const additionText = ref("");
const additionNotice = ref("");
const paperMode = ref<"edit" | "paper">("edit");
const paperContext = computed(() => {
  const current = body.value;
  if (!current || loading.value || props.saving || props.paperDisabled ||
    current.contractVersionId !== props.contractVersionId || current.draftRevision !== props.draftRevision ||
    current.layoutTemplateVersionId !== props.layoutTemplateVersionId) return null;
  return {
    contractVersionId: current.contractVersionId, draftRevision: current.draftRevision,
    documentContentRevision: current.documentContentRevision, layoutTemplateVersionId: current.layoutTemplateVersionId,
    sourceSha256: current.sourceSha256
  };
});
const canOpenPaper = computed(() => Boolean(paperContext.value && !additionVisible.value && !regenerationVisible.value && !tableEditorVisible.value));
function openPaper() { if (canOpenPaper.value) paperMode.value = "paper"; }
watch(() => [props.contractVersionId, props.draftRevision, props.layoutTemplateVersionId, body.value?.sourceSha256,
  props.paperDisabled, props.saving, props.editPlan, loading.value] as const, () => { paperMode.value = "edit"; });
const regenerationVisible = ref(false);
const regenerationConfirmation = ref<(Omit<ContractBodyUpdateContext, "action"> & { editPlanJson: string }) | null>(null);
const canStartRegeneration = computed(() => {
  const current = body.value;
  return Boolean(current && !props.disabled && !loading.value && !props.saving &&
    current.contractVersionId === props.contractVersionId && current.draftRevision === props.draftRevision &&
    current.layoutTemplateVersionId === props.layoutTemplateVersionId);
});
const canConfirmRegeneration = computed(() => {
  const current = body.value, confirmation = regenerationConfirmation.value;
  return Boolean(canStartRegeneration.value && current && confirmation &&
    current.contractVersionId === confirmation.contractVersionId && current.draftRevision === confirmation.draftRevision &&
    current.layoutTemplateVersionId === confirmation.layoutTemplateVersionId && current.sourceSha256 === confirmation.sourceSha256 &&
    JSON.stringify(props.editPlan ?? null) === confirmation.editPlanJson);
});
function openRegeneration() {
  const current = body.value;
  if (!current || !canStartRegeneration.value) return;
  regenerationConfirmation.value = {
    contractVersionId: current.contractVersionId, draftRevision: current.draftRevision,
    layoutTemplateVersionId: current.layoutTemplateVersionId, sourceSha256: current.sourceSha256,
    editPlanJson: JSON.stringify(props.editPlan ?? null)
  };
  regenerationVisible.value = true;
}
function cancelRegeneration() {
  regenerationVisible.value = false;
  regenerationConfirmation.value = null;
}
function confirmRegeneration() {
  const confirmation = regenerationConfirmation.value;
  if (!confirmation || !canConfirmRegeneration.value) return;
  emit("update", { protocolVersion: 1, layoutTemplateVersionId: confirmation.layoutTemplateVersionId,
    sourceSha256: confirmation.sourceSha256, edits: [] }, {
    contractVersionId: confirmation.contractVersionId, draftRevision: confirmation.draftRevision,
    layoutTemplateVersionId: confirmation.layoutTemplateVersionId, sourceSha256: confirmation.sourceSha256,
    action: { kind: "regenerate", confirmOverwrite: true }
  });
  cancelRegeneration();
  additionNotice.value = "已确认重新生成正文，请以正文保存回执为准。";
}
const additionOptions = computed(() => (body.value?.flow ?? []).flatMap(node => {
  if (node.kind !== "paragraph" || node.paragraphId.startsWith("added:")) return [];
  const block = displayBlocks.value[node.paragraphId];
  if (!block?.editable || currentPlan()?.deletedPositionIds?.includes(block.id)) return [];
  return [{ value: block.id, label: `段落${paragraphNumbers.value[block.id]}后：${block.text.slice(0, 48) || "空白段落"}` }];
}));
const canStartAddition = computed(() => {
  const current = body.value;
  return Boolean(current && !props.disabled && !loading.value && current.contractVersionId === props.contractVersionId &&
    current.layoutTemplateVersionId === props.layoutTemplateVersionId && additionOptions.value.length > 0);
});
function openAddition() {
  if (!canStartAddition.value) return;
  additionAfter.value = additionOptions.value[0].value;
  additionText.value = "";
  additionVisible.value = true;
}
function addParagraph() {
  const current = body.value;
  if (!current || !canStartAddition.value || !additionText.value.trim() ||
    !additionOptions.value.some(option => option.value === additionAfter.value)) return;
  const previous = currentPlan();
  const plan: ContractBodyEditPlan = previous ? { ...previous } : {
    protocolVersion: 1, layoutTemplateVersionId: current.layoutTemplateVersionId, sourceSha256: current.sourceSha256, edits: []
  };
  plan.additions = [...(plan.additions ?? []), { id: crypto.randomUUID(), afterPositionId: additionAfter.value, text: additionText.value }];
  emit("update", plan);
  additionVisible.value = false;
  additionNotice.value = "新增条款已加入当前草稿，请以正文保存回执为准。";
}

const tableEditorVisible = ref(false);
const tableParagraphIds = ref<string[]>([]);
const tableParagraphId = ref("");
const tableParagraphOptions = computed(() => tableParagraphIds.value.filter(id => displayBlocks.value[id]?.editable).map(id => ({
  value: id, label: `段落${paragraphNumbers.value[id]}：${displayBlocks.value[id].text.slice(0, 48) || "空白段落"}`
})));
const selectedTableParagraph = computed(() => {
  const paragraph = displayBlocks.value[tableParagraphId.value];
  return tableParagraphIds.value.includes(tableParagraphId.value) && paragraph?.editable ? paragraph : null;
});
function openTableEditor(ids: string[]) {
  if (props.disabled) return;
  tableParagraphIds.value = ids.filter(id => displayBlocks.value[id]?.editable);
  tableParagraphId.value = tableParagraphIds.value[0] ?? "";
  tableEditorVisible.value = Boolean(tableParagraphId.value);
}

function currentPlan(): ContractBodyEditPlan | null {
  const value = props.editPlan;
  if (!body.value || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as ContractBodyEditPlan;
  return plan.protocolVersion === 1 && plan.layoutTemplateVersionId === body.value.layoutTemplateVersionId &&
    plan.sourceSha256 === body.value.sourceSha256 && Array.isArray(plan.edits) ? plan : null;
}

const removableAdditionIds = computed(() => {
  const current = body.value, plan = currentPlan();
  if (!current || !plan || current.contractVersionId !== props.contractVersionId || current.draftRevision !== props.draftRevision || current.layoutTemplateVersionId !== props.layoutTemplateVersionId) return [];
  const topLevelIds = new Set(current.flow.flatMap(node => node.kind === "paragraph" ? [node.paragraphId] : []));
  return current.blocks.filter(block => block.editable && block.id.startsWith("added:") && topLevelIds.has(block.id) &&
    plan.additions?.some(addition => `added:${addition.id}` === block.id)).map(block => block.id);
});

const sourceDeletionCandidates = computed(() => {
  const current = body.value, plan = currentPlan();
  if (!current || (props.editPlan != null && !plan) || current.contractVersionId !== props.contractVersionId ||
    current.draftRevision !== props.draftRevision || current.layoutTemplateVersionId !== props.layoutTemplateVersionId) return [];
  const topLevelIds = new Set(current.flow.flatMap(node => node.kind === "paragraph" ? [node.paragraphId] : []));
  const sourceIds = new Set(current.paragraphGroups.flat());
  return current.blocks.filter(block => block.editable && sourceIds.has(block.id) && topLevelIds.has(block.id) &&
    !block.id.startsWith("added:") && !block.id.startsWith("generated:") && !plan?.deletedPositionIds?.includes(block.id)).map(block => block.id);
});

const anchoredSourceIds = computed(() => sourceDeletionCandidates.value.filter(id => currentPlan()?.additions?.some(addition => addition.afterPositionId === id)));
const removableSourceIds = computed(() => sourceDeletionCandidates.value.filter(id => !anchoredSourceIds.value.includes(id)));

function deleteSourceParagraph(id: string) {
  const current = body.value;
  if (!current || props.disabled || loading.value || props.saving || !removableSourceIds.value.includes(id)) return;
  const plan = currentPlan() ?? { protocolVersion: 1 as const, layoutTemplateVersionId: current.layoutTemplateVersionId,
    sourceSha256: current.sourceSha256, edits: [] };
  emit("update", { ...plan, edits: plan.edits.filter(edit => edit.positionId !== id),
    deletedPositionIds: [...new Set([...(plan.deletedPositionIds ?? []), id])],
    ...(plan.paragraphOrder ? { paragraphOrder: plan.paragraphOrder.filter(positionId => positionId !== id) } : {}) });
  additionNotice.value = "已从当前草稿移除普通条款，请以正文保存回执为准。";
}

function deleteAddedParagraph(id: string) {
  const current = body.value, plan = currentPlan();
  if (!current || !plan || props.disabled || loading.value || props.saving ||
    current.contractVersionId !== props.contractVersionId || current.draftRevision !== props.draftRevision || current.layoutTemplateVersionId !== props.layoutTemplateVersionId ||
    !removableAdditionIds.value.includes(id)) return;
  const soleSavedAddition = current.blocks.filter(block => block.id.startsWith("added:")).length === 1 &&
    plan.additions?.length === 1 && plan.edits.length === 0 && !plan.deletedPositionIds?.length && !plan.paragraphOrder?.length;
  const deletion: ContractBodyDeleteSavedAdditionContext | undefined = soleSavedAddition ? {
    contractVersionId: current.contractVersionId, draftRevision: current.draftRevision,
    layoutTemplateVersionId: current.layoutTemplateVersionId, sourceSha256: current.sourceSha256,
    action: { kind: "delete_saved_addition", additionId: plan.additions![0].id }
  } : undefined;
  emit("update", { ...plan, additions: (plan.additions ?? []).filter(addition => `added:${addition.id}` !== id) }, deletion);
  additionNotice.value = "已从当前草稿移除新增条款，请以正文保存回执为准。";
}

const displayBlocks = computed<Record<string, ContractBodyParagraph>>(() => {
  const plan = currentPlan();
  return Object.fromEntries((body.value?.blocks ?? []).filter(block => !plan || !block.id.startsWith("added:") ||
    plan.additions?.some(addition => `added:${addition.id}` === block.id)).map(block => {
    const edit = plan?.edits.find(value => value.positionId === block.id);
    const addition = block.id.startsWith("added:") ? plan?.additions?.find(value => `added:${value.id}` === block.id) : undefined;
    const text = edit ? edit.text : addition ? block.text.replace(/^(补充条款\d+：).*/su, (_match, prefix: string) => `${prefix}${addition.text}`) : block.text;
    const blankFields = [...new Set(Array.from(text.matchAll(/【待补充：([^】]+)】/gu), match => match[1]))];
    return [block.id, { ...block, text, blankFields }];
  }));
});
const paragraphOrdering = computed(() => {
  const current = body.value, plan = currentPlan();
  if (!current ||
    current.contractVersionId !== props.contractVersionId || current.draftRevision !== props.draftRevision ||
    current.layoutTemplateVersionId !== props.layoutTemplateVersionId || (props.editPlan != null && !plan)) return null;
  const deleted = new Set(plan?.deletedPositionIds ?? []);
  // Retain invisible source controls in the complete server-owned order.
  const groups = current.paragraphGroups.map(group => group.filter(id => !deleted.has(id)));
  const ids = groups.flat();
  if (new Set(ids).size !== ids.length) return null;
  const order = plan?.paragraphOrder ?? ids;
  if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length) return null;
  let offset = 0;
  const orderedGroups = groups.map(group => {
    const ordered = order.slice(offset, offset + group.length);
    offset += group.length;
    return ordered;
  });
  if (orderedGroups.some((group, index) => group.some(id => !groups[index].includes(id)))) return null;
  const groupById = new Map(groups.flatMap((group, index) => group.map(id => [id, index] as const)));
  const topLevelIds = current.flow.flatMap(node => node.kind === "paragraph" ? [node.paragraphId] : []);
  const chunks: Array<{ id?: string; nodes: ContractBodyFlowNode[] }> = [];
  for (const node of current.flow) {
    if (node.kind !== "paragraph") { chunks.push({ nodes: [node] }); continue; }
    const id = node.paragraphId;
    if (deleted.has(id) || (id.startsWith("added:") && !displayBlocks.value[id])) continue;
    const previous = chunks.at(-1);
    // Saved additions follow their source anchor; they never receive an order ID.
    if (id.startsWith("added:") && previous?.id &&
      plan?.additions?.some(addition => `added:${addition.id}` === id && addition.afterPositionId === previous.id)) {
      previous.nodes.push(node);
      continue;
    }
    const movable = groupById.has(id) && !id.startsWith("added:") && !id.startsWith("generated:") &&
      displayBlocks.value[id]?.editable && topLevelIds.filter(value => value === id).length === 1;
    chunks.push({ ...(movable ? { id } : {}), nodes: [node] });
  }
  const moves: Record<string, { up: boolean; down: boolean }> = {};
  const preview = [...chunks];
  for (let start = 0; start < chunks.length;) {
    const firstId = chunks[start].id;
    if (!firstId) { start++; continue; }
    const groupIndex = groupById.get(firstId)!;
    const group = groups[groupIndex];
    const groupStart = group.indexOf(firstId);
    let end = start + 1;
    while (end < chunks.length && groupStart + end - start < group.length &&
      chunks[end].id !== undefined && chunks[end].id === group[groupStart + end - start]) end++;
    const run = chunks.slice(start, end);
    const target = orderedGroups[groupIndex].slice(groupStart, groupStart + run.length);
    if (target.some(id => !run.some(chunk => chunk.id === id))) return null;
    target.forEach((id, index) => {
      preview[start + index] = run.find(chunk => chunk.id === id)!;
      moves[id] = { up: index > 0, down: index < target.length - 1 };
    });
    start = end;
  }
  return { groups: orderedGroups, flow: preview.flatMap(chunk => chunk.nodes), moves };
});
const displayFlow = computed(() => paragraphOrdering.value?.flow ?? body.value?.flow ?? []);
const paragraphMoves = computed(() => paragraphOrdering.value?.moves ?? {});

function moveParagraph(id: string, direction: -1 | 1) {
  const current = body.value, ordering = paragraphOrdering.value;
  if (!current || !ordering || props.disabled || loading.value || props.saving ||
    current.contractVersionId !== props.contractVersionId || current.draftRevision !== props.draftRevision ||
    current.layoutTemplateVersionId !== props.layoutTemplateVersionId ||
    !ordering.moves[id]?.[direction === -1 ? "up" : "down"]) return;
  const groups = ordering.groups.map(group => [...group]);
  const group = groups.find(value => value.includes(id));
  if (!group) return;
  const index = group.indexOf(id), next = index + direction;
  if (!ordering.moves[group[next]]) return;
  [group[index], group[next]] = [group[next], group[index]];
  const previous = currentPlan();
  const plan: ContractBodyEditPlan = previous ? { ...previous } : {
    protocolVersion: 1, layoutTemplateVersionId: current.layoutTemplateVersionId, sourceSha256: current.sourceSha256, edits: []
  };
  emit("update", { ...plan, paragraphOrder: groups.flat() });
  additionNotice.value = "条款顺序已调整，请以正文保存回执为准。";
}
const paragraphNumbers = computed(() => Object.fromEntries((body.value?.blocks ?? []).map((block, index) => [block.id, index + 1])));

const blankReviewContext = computed<BodyBlankReviewContext | null>(() => {
  const current = body.value, plan = currentPlan();
  if (!current || loading.value || current.contractVersionId !== props.contractVersionId ||
    current.draftRevision !== props.draftRevision || current.layoutTemplateVersionId !== props.layoutTemplateVersionId ||
    (props.editPlan != null && !plan)) return null;
  const remaining = Object.values(displayBlocks.value).filter(block => block.editable && block.blankFields.length > 0 &&
    !plan?.deletedPositionIds?.includes(block.id)).map(block => ({
    positionId: block.id, number: paragraphNumbers.value[block.id], labels: [...block.blankFields]
  }));
  return {
    contractVersionId: current.contractVersionId, draftRevision: current.draftRevision,
    documentContentRevision: current.documentContentRevision, layoutTemplateVersionId: current.layoutTemplateVersionId,
    sourceSha256: current.sourceSha256, planJson: JSON.stringify(props.editPlan ?? null), remaining
  };
});
const remainingBlankCount = computed(() => blankReviewContext.value?.remaining.reduce((sum, entry) => sum + entry.labels.length, 0) ?? 0);
const blankReviewConfirmed = computed(() => {
  const current = blankReviewContext.value, receipt = props.blankReviewReceipt;
  return Boolean(current && receipt && !props.disabled && !props.saving && !props.reviewDisabled &&
    current.contractVersionId === receipt.contractVersionId && current.draftRevision === receipt.draftRevision &&
    current.documentContentRevision === receipt.documentContentRevision && current.layoutTemplateVersionId === receipt.layoutTemplateVersionId &&
    current.sourceSha256 === receipt.sourceSha256 && current.planJson === receipt.planJson &&
    JSON.stringify(current.remaining) === JSON.stringify(receipt.remaining));
});
function requestBlankReview() {
  const context = blankReviewContext.value;
  if (!context || props.disabled || loading.value || props.saving || props.reviewDisabled) return;
  emit("review-blanks", { ...context, remaining: context.remaining.map(entry => ({ ...entry, labels: [...entry.labels] })) });
}


function editParagraph(id: string, text: string) {
  const current = body.value;
  if (props.disabled || current?.contractVersionId !== props.contractVersionId || current.layoutTemplateVersionId !== props.layoutTemplateVersionId || !current.blocks.some(block => block.id === id && block.editable)) return;
  const previous = currentPlan();
  const plan: ContractBodyEditPlan = previous ? { ...previous } : { protocolVersion: 1, layoutTemplateVersionId: current.layoutTemplateVersionId, sourceSha256: current.sourceSha256, edits: [] };
  if (id.startsWith("added:")) {
    plan.additions = (plan.additions ?? []).map(addition => `added:${addition.id}` === id ? { ...addition, text: text.replace(/^补充条款\d+：/u, "") } : addition);
  } else plan.edits = [...plan.edits.filter(edit => edit.positionId !== id), { positionId: id, text }];
  emit("update", plan);
}

async function readBody() {
  const request = ++requestId;
  const version = props.contractVersionId, revision = props.draftRevision, layout = props.layoutTemplateVersionId;
  error.value = "";
  if (!version || !layout) { body.value = null; loading.value = false; return; }
  loading.value = true;
  const stillCurrent = () => request === requestId && version === props.contractVersionId && revision === props.draftRevision && layout === props.layoutTemplateVersionId;
  try {
    const result = await fetchContractDraftBody(version);
    if (!stillCurrent()) return;
    if (result.contractVersionId !== version || result.draftRevision !== revision || result.layoutTemplateVersionId !== layout) {
      throw new Error("正文与当前保存资料不一致，请核对保存结果后重新读取");
    }
    body.value = result;
  } catch (cause) {
    if (stillCurrent()) { body.value = null; error.value = formatUnknownApiError(cause, "完整正文读取失败，请稍后重试"); }
  } finally { if (stillCurrent()) loading.value = false; }
}

watch(() => [props.contractVersionId, props.draftRevision, props.layoutTemplateVersionId] as const, (next, previous) => {
  if (!previous || next[0] !== previous[0] || next[2] !== previous[2]) body.value = null;
  void readBody();
}, { immediate: true });
watch([() => props.contractVersionId, () => props.layoutTemplateVersionId, () => body.value?.sourceSha256], () => {
  additionVisible.value = false;
  additionAfter.value = "";
  additionText.value = "";
  additionNotice.value = "";
  tableEditorVisible.value = false;
  tableParagraphIds.value = [];
  tableParagraphId.value = "";
});
watch(() => [props.contractVersionId, props.draftRevision, props.layoutTemplateVersionId, body.value?.sourceSha256, props.editPlan] as const, () => {
  if (!regenerationVisible.value) return;
  cancelRegeneration();
  additionNotice.value = "正文内容已变化，请重新核对后再生成。";
});
onBeforeUnmount(() => { requestId++; });
</script>

<style scoped>
.body-editor { min-width: 0; border: 1px solid var(--jg-border); border-radius: var(--jg-radius-sm); background: var(--jg-bg-panel); }
.body-editor-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--jg-space-md); padding: var(--jg-space-lg); border-bottom: 1px solid var(--jg-border); }
.body-editor-toolbar h2 { margin: 0 0 var(--jg-space-sm); font-size: var(--jg-font-section-title); color: var(--jg-text-strong); }
.body-editor-toolbar p { margin: 0; color: var(--jg-text-muted); }
.body-editor-paper { min-width: 0; width: 100%; box-sizing: border-box; padding: var(--jg-space-xl); color: var(--jg-text-main); }
.body-table-edit-label { display: block; margin: var(--jg-space-md) 0; }
.body-editor-error, .body-editor-note { padding: var(--jg-space-lg); color: var(--jg-text-muted); }
@media (max-width: 600px) { .body-editor-toolbar { align-items: flex-start; flex-direction: column; } .body-editor-paper { padding: var(--jg-space-md); } }
</style>
