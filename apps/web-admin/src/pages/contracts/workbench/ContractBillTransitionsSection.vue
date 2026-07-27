<template>
  <t-card
    class="transition-card"
    title="旧版结算承接映射"
  >
    <p class="hint">
      只处理旧版已生效结算的清单。保存后由合同部主任确认；确认前不能提交变更合同。
    </p>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <t-loading
      v-if="loading"
      text="正在读取旧版结算清单……"
    />
    <template v-else-if="options">
      <p
        v-if="!options.sources.length"
        class="hint"
      >
        旧版没有需要承接的已结算清单行。
      </p>
      <div
        v-else
        class="rows"
      >
        <div
          v-for="(row, index) in rows"
          :key="row.key"
          class="row"
        >
          <t-select
            v-model="row.sourceId"
            :options="sourceOptions"
            placeholder="旧版已结算行"
            @change="syncSource(row)"
          />
          <t-select
            v-model="row.targetId"
            :options="targetOptions"
            placeholder="新版目标行"
          />
          <t-input
            v-model="row.sourceQuantity"
            placeholder="来源已结数量"
          />
          <t-input
            v-model="row.targetQuantity"
            placeholder="目标期初数量"
          />
          <t-input
            v-model="row.amountCents"
            placeholder="历史金额（分）"
          />
          <t-input
            v-model="row.basis"
            placeholder="单位变化时填写换算依据"
          />
          <t-button
            variant="text"
            theme="danger"
            :disabled="disabled || busy"
            @click="rows.splice(index, 1)"
          >
            删除
          </t-button>
        </div>
        <div class="actions">
          <t-button
            variant="outline"
            :disabled="disabled || busy"
            @click="addRow"
          >
            新增映射
          </t-button>
          <t-button
            theme="primary"
            :loading="busy === 'save'"
            :disabled="disabled || !rows.length"
            @click="save"
          >
            保存映射
          </t-button>
          <t-button
            v-if="hasDraft"
            theme="warning"
            variant="outline"
            :loading="busy === 'discard'"
            :disabled="disabled"
            @click="discard"
          >
            撤销未确认映射
          </t-button>
          <t-button
            v-if="options.canConfirm && hasDraft"
            theme="success"
            :loading="busy === 'confirm'"
            @click="confirm"
          >
            合同部主任确认
          </t-button>
        </div>
      </div>
    </template>
  </t-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { centsTextToYuanText } from "../../../lib/money";
import { confirmContractBillTransitions, discardContractBillTransitions, fetchContractBillTransitionOptions, fetchContractBillTransitions, saveContractBillTransitions, type ContractBillTransitionOptions } from "../../../api/contract-workbench.api";

const props = defineProps<{ contractVersionId: string; revision: number; disabled: boolean }>();
const emit = defineEmits<{ changed: [] }>();
type Row = { key: string; sourceId: string; targetId: string; sourceQuantity: string; targetQuantity: string; amountCents: string; basis: string };
const options = ref<ContractBillTransitionOptions | null>(null);
const rows = ref<Row[]>([]); const loading = ref(false); const busy = ref<"" | "save" | "discard" | "confirm">(""); const error = ref(""); const hasDraft = ref(false);
const sourceOptions = computed(() => (options.value?.sources ?? []).map(row => ({ value: row.id, label: `${row.itemName}${row.specification ? `（${row.specification}）` : ""}｜已结 ${row.historicalQuantity ?? "无数量"} ${row.unit}｜${centsTextToYuanText(row.historicalAmountCents)} 元` })));
const targetOptions = computed(() => (options.value?.targets ?? []).map(row => ({ value: row.id, label: `${row.itemName}${row.specification ? `（${row.specification}）` : ""}｜${row.unit}` })));
function addRow() { rows.value.push({ key: crypto.randomUUID(), sourceId: "", targetId: "", sourceQuantity: "", targetQuantity: "", amountCents: "", basis: "" }); }
function syncSource(row: Row) { const source = options.value?.sources.find(item => item.id === row.sourceId); if (!source) return; row.sourceQuantity = source.historicalQuantity ?? ""; row.targetQuantity = source.historicalQuantity ?? ""; row.amountCents = source.historicalAmountCents; }
async function load() { loading.value = true; error.value = ""; try { const [nextOptions, mappings] = await Promise.all([fetchContractBillTransitionOptions(props.contractVersionId), fetchContractBillTransitions(props.contractVersionId)]); options.value = nextOptions; hasDraft.value = mappings.some(item => item.status === "draft" && item.matchBasis === "manual"); rows.value = mappings.filter(item => item.status !== "invalidated" && item.matchBasis === "manual").map(item => ({ key: String(item.id), sourceId: String(item.sourceContractBillRowId), targetId: String(item.targetContractBillRowId), sourceQuantity: String(item.sourceSettledQuantityAllocated ?? ""), targetQuantity: String(item.targetOpeningQuantity ?? ""), amountCents: String(item.settledAmountAllocatedCents ?? ""), basis: String(item.quantityConversionBasis ?? "") })); if (!rows.value.length && nextOptions.sources.length) addRow(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "读取跨版本映射失败"; } finally { loading.value = false; } }
async function save() { if (!options.value) return; busy.value = "save"; error.value = ""; try { await saveContractBillTransitions(props.contractVersionId, { fromContractVersionId: options.value.fromContractVersionId!, expectedTargetVersionRevision: props.revision, mappings: rows.value.map(row => ({ sourceContractBillRowId: row.sourceId, targetContractBillRowId: row.targetId, sourceSettledQuantityAllocated: row.sourceQuantity, targetOpeningQuantity: row.targetQuantity, settledAmountAllocatedCents: row.amountCents, ...(row.basis.trim() ? { quantityConversionBasis: row.basis.trim() } : {}) })) }); emit("changed"); await load(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "保存跨版本映射失败"; } finally { busy.value = ""; } }
async function discard() { if (!options.value) return; busy.value = "discard"; try { await discardContractBillTransitions(props.contractVersionId, { fromContractVersionId: options.value.fromContractVersionId!, expectedTargetVersionRevision: props.revision }); emit("changed"); await load(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "撤销失败"; } finally { busy.value = ""; } }
async function confirm() { busy.value = "confirm"; try { await confirmContractBillTransitions(props.contractVersionId, { expectedTargetVersionRevision: props.revision }); emit("changed"); await load(); } catch (cause) { error.value = cause instanceof Error ? cause.message : "确认失败"; } finally { busy.value = ""; } }
onMounted(load); watch(() => props.contractVersionId, load);
</script>

<style scoped>
.transition-card,.rows{display:grid;gap:var(--jg-space-md)}.hint{margin:0;color:var(--jg-color-text-secondary);font-size:var(--jg-font-size-meta)}.row{display:grid;grid-template-columns:1.4fr 1.4fr repeat(3,minmax(0,1fr)) 1.4fr auto;gap:var(--jg-space-sm);align-items:center}.actions{display:flex;gap:var(--jg-space-sm);flex-wrap:wrap}@media (max-width:1100px){.row{grid-template-columns:1fr 1fr}}@media (max-width:767px){.row{grid-template-columns:1fr}}
</style>
