<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { chinaDateTimeInput } from "@jiangkong/shared-domain";
import { useAuthStore } from "../../auth/auth.store";
import { formatUnknownApiError } from "../../api/error-message";
import {
  fetchPublicCashHandovers, PublicCashHandoverError, assertPublicCashHandoverReceipt,
  claimInitialPublicCashCustody, startPublicCashHandover, confirmPublicCashHandover,
  type PublicCashHandover, type PublicCashHandoverCommand, type PublicCashHandoverReadModel
} from "../../api/public-cash-handover.api";

const auth = useAuthStore();
const actor = computed(() => auth.user?.id ?? "");
const model = ref<PublicCashHandoverReadModel>();
const pending = ref<PublicCashHandoverCommand | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const success = ref("");
const toCustodianId = ref("");
const deliveredYuan = ref("");
const evidence = ref("");
const selected = ref<PublicCashHandover | null>(null);
const receivedYuan = ref("");
const storageKey = (actorId: string) => `jg:public-cash-handover:${actorId}`;
const amount = (value: string | null) => value === null ? "待核对" : `¥${value}`;
const statusText: Record<PublicCashHandover["status"], string> = {
  pending: "待新保管人确认", superseded: "有新现金记录，须重新盘点",
  confirmed: "交接完成", awaiting_reconciliation: "交接完成，差额待核对"
};
const options = computed(() => model.value?.candidates.map(user => ({ value: user.id, label: user.name })) ?? []);

const claimAllowed = computed(() => model.value?.canClaimInitial === true && !pending.value);
const startAllowed = computed(() => model.value?.canStart === true && !pending.value);
const confirmAllowed = computed(() => !pending.value && model.value?.handovers.some(
  row => row.id === selected.value?.id && row.canConfirm
) === true);
const recoveryAllowed = computed(() => {
  const command = pending.value;
  if (!command || !model.value) return false;
  if (command.type === "claim") return model.value.canRecoverInitial;
  if (command.type === "start") return model.value.canStart || model.value.handovers.some(row => row.canRecoverStart);
  return model.value.handovers.some(row => row.id === command.handoverId && row.canRecoverConfirmation);
});

function readPending(actorId: string) {
  const saved = localStorage.getItem(storageKey(actorId));
  if (!saved) return null;
  const command = JSON.parse(saved) as PublicCashHandoverCommand;
  if ((command.type !== "claim" && command.type !== "start" && command.type !== "confirm") || typeof command.input?.idempotencyKey !== "string") {
    throw new Error("原交接凭据无法读取，请保留浏览器记录");
  }
  return command;
}

async function load() {
  const owner = actor.value;
  if (!owner) return;
  loading.value = true;
  try {
    const next = await fetchPublicCashHandovers();
    if (actor.value === owner) model.value = next;
  } catch (failure) {
    if (actor.value === owner) error.value = formatUnknownApiError(failure, "现金交接资料读取失败");
  } finally {
    if (actor.value === owner) loading.value = false;
  }
}

async function run(proposal?: PublicCashHandoverCommand) {
  const owner = actor.value;
  if (saving.value || !owner) return;
  saving.value = true;
  error.value = "";
  success.value = "";
  const key = storageKey(owner);
  const expectedPending = proposal ? null : pending.value;
  try {
    if (!navigator.locks) throw new Error("当前浏览器无法安全保存交接凭据");
    await navigator.locks.request(key, { mode: "exclusive" }, async () => {
      if (actor.value !== owner) return;
      const existing = readPending(owner);
      if (existing && (proposal || JSON.stringify(existing) !== JSON.stringify(expectedPending))) {
        pending.value = existing;
        return;
      }
      const command = existing ?? proposal;
      if (!command) { pending.value = null; return; }
      if (!existing) localStorage.setItem(key, JSON.stringify(command));
      pending.value = command;
      try {
        const result = command.type === "claim" ? await claimInitialPublicCashCustody(command.input)
          : command.type === "start" ? await startPublicCashHandover(command.input)
            : await confirmPublicCashHandover(command.handoverId, command.input);
        assertPublicCashHandoverReceipt(command, result);
        localStorage.removeItem(key);
        if (actor.value !== owner) return;
        pending.value = null;
        selected.value = null;
        toCustodianId.value = "";
        deliveredYuan.value = "";
        evidence.value = "";
        success.value = command.type === "claim" ? "已登记本人为首任保管人。"
          : command.type === "start" ? "交接已登记，等待指定的新保管人确认。" : "已记录实点并完成交接，请核对结果。";
        await load();
      } catch (failure) {
        const rejected = failure instanceof PublicCashHandoverError && (failure.superseded || (!existing && failure.definitive));
        if (rejected) localStorage.removeItem(key);
        if (actor.value !== owner) return;
        if (rejected) {
          pending.value = null;
          selected.value = null;
          error.value = formatUnknownApiError(failure, "交接未保存，请刷新后重新盘点");
          await load();
        } else error.value = "结果尚未确认。请保留原凭据，按原内容重试。";
      }
    });
  } catch (failure) {
    if (actor.value === owner) error.value = formatUnknownApiError(failure, "交接办理失败，请保留原凭据");
  } finally {
    if (actor.value === owner) saving.value = false;
  }
}

function retryPending() { if (recoveryAllowed.value) void run(); }
function claim() {
  if (!claimAllowed.value || model.value?.revision == null) return;
  void run({ type: "claim", input: { idempotencyKey: crypto.randomUUID(), expectedRevision: model.value.revision } });
}
function start() {
  if (!startAllowed.value || model.value?.revision == null || !toCustodianId.value || !deliveredYuan.value.trim() || !evidence.value.trim()) return;
  void run({ type: "start", input: { idempotencyKey: crypto.randomUUID(), expectedRevision: model.value.revision,
    toCustodianId: toCustodianId.value, deliveredYuan: deliveredYuan.value.trim(), evidenceReference: evidence.value.trim() } });
}
function confirm() {
  if (!confirmAllowed.value || !selected.value || !receivedYuan.value.trim()) return;
  void run({ type: "confirm", handoverId: selected.value.id,
    input: { idempotencyKey: crypto.randomUUID(), receivedYuan: receivedYuan.value.trim() } });
}
watch(actor, owner => {
  model.value = undefined;
  pending.value = null;
  selected.value = null;
  saving.value = false;
  error.value = "";
  success.value = "";
  if (!owner) return;
  try { pending.value = readPending(owner); }
  catch (failure) { error.value = formatUnknownApiError(failure, "交接凭据读取失败"); }
  void load();
}, { immediate: true });
</script>

<template>
  <t-card title="公共现金保管交接">
    <t-space direction="vertical" size="medium">
      <t-button variant="outline" :loading="loading" @click="load">刷新交接</t-button>
      <t-alert v-if="error" theme="error" :message="error" />
      <t-alert v-if="success" theme="success" :message="success" />
      <p v-if="model">
        当前保管人 {{ model.currentCustodian?.name || '待核对' }}{{ model.currentCustodian?.isActive === false ? '（账号已停用）' : '' }}
      </p>
      <t-popconfirm v-if="claimAllowed" content="确认由你本人担任公共现金首任保管人？" @confirm="claim">
        <t-button :loading="saving">登记本人为首任保管人</t-button>
      </t-popconfirm>
      <t-alert v-if="pending" theme="warning" message="有一笔交接结果尚未确认，请按原内容重试。" />
      <t-button v-if="recoveryAllowed" :loading="saving" @click="retryPending">按原凭据重试</t-button>
      <t-space v-if="startAllowed" direction="vertical">
        <label>
          新保管人
          <t-select v-model="toCustodianId" :options="options" placeholder="选择新保管人" />
        </label>
        <label>
          实际交出金额（元）
          <t-input v-model="deliveredYuan" inputmode="decimal" />
        </label>
        <label>
          交付和盘点依据
          <t-textarea v-model="evidence" :maxlength="1000" />
        </label>
        <t-button :loading="saving" :disabled="!toCustodianId || !deliveredYuan.trim() || !evidence.trim()" @click="start">发起现金交接</t-button>
      </t-space>
      <t-space v-if="selected && confirmAllowed" direction="vertical">
        <p>原交出 {{ amount(selected.deliveredYuan) }}。请填写你实际点收的金额。</p>
        <label>
          实点接收金额（元）
          <t-input v-model="receivedYuan" inputmode="decimal" />
        </label>
        <t-space>
          <t-button :loading="saving" :disabled="!receivedYuan.trim()" @click="confirm">确认实际接收</t-button>
          <t-button variant="outline" :disabled="saving" @click="selected = null">取消</t-button>
        </t-space>
      </t-space>
      <t-card v-for="row in model?.handovers" :key="row.id" :title="`${row.fromName} → ${row.toName}`">
        <p>{{ statusText[row.status] }} · {{ chinaDateTimeInput(new Date(row.createdAt)) }} · 发起人 {{ row.startedByName }}</p>
        <p>交出 {{ amount(row.deliveredYuan) }} · 交接时系统余额 {{ amount(row.expectedBalanceYuan) }}</p>
        <p>{{ row.evidenceReference }}</p>
        <p v-if="row.confirmation">
          实点 {{ amount(row.confirmation.amountReceivedYuan) }} · 账实差额 {{ amount(row.confirmation.discrepancyYuan) }} · 交付与实点差额 {{ amount(row.confirmation.handoverDifferenceYuan) }}
        </p>
        <p v-if="row.status === 'awaiting_reconciliation'">余额沿用原账，差额请由财务在公共现金发起余额核对更正。</p>
        <t-button v-if="row.canConfirm && !pending" variant="outline" :disabled="saving" @click="selected = row; receivedYuan = ''">核对并接收</t-button>
      </t-card>
    </t-space>
  </t-card>
</template>
