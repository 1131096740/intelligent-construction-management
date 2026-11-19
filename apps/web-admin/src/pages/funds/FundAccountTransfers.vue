<script setup lang="ts">
import { chinaDateOnly, chinaDateTimeInput } from "@jiangkong/shared-domain";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { fetchFundAccountTransfers, type FundTransfer, type FundTransferAction, type FundTransferReadModel, type FundTransferStatus } from "../../api/fund-account-transfer.api";
import type { FundAccount, FundAvailableSource } from "../../api/fund-account.api";
import { formatUnknownApiError } from "../../api/error-message";
import DutySmsStatusPanel from "../../components/DutySmsStatusPanel.vue";
import { useAuthStore } from "../../auth/auth.store";
import { readFundTransferCommand, submitFundTransferCommand, type FundTransferCommand } from "./fund-transfer-command";

const props = defineProps<{
  accounts: FundAccount[];
  projects: Array<{ id: string; name: string }>;
  accountLoading: boolean;
}>();
const emit = defineEmits<{ refreshAccounts: [] }>();
const auth = useAuthStore();
const actorId = computed(() => auth.user?.id ?? "");
const model = ref<FundTransferReadModel | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const pending = ref<FundTransferCommand | null>(null);
const storageReady = ref(false);

const direction = ref<"cash" | "company" | null>(null);
const selectedCompany = ref("");
const registrationAccounts = ref<FundAccount[]>([]);
const date = ref(chinaDateOnly());
const reference = ref("");
const allocations = ref<Record<string, string>>({});
const selectedAction = ref<{ transfer: FundTransfer; action: FundTransferAction } | null>(null);
const statusLabel: Record<FundTransferStatus, string> = {
  pending_receipt: "待确认实收", rejected_held: "已驳回，资金仍待核对",
  received: "已确认实收", returned: "已确认实际退回"
};
const actionLabel = {
  register: "登记转出", confirm: "确认实际收到", reject: "驳回待核对",
  resubmit: "补充依据并重提", return: "确认资金实际退回"
};
const actionPrompt: Record<FundTransferAction, string> = {
  confirm: "请核对实际收到的金额与本笔转款一致，再填写到账依据。",
  reject: "请填写差异或驳回原因。驳回后转出账户的资金仍不可用。",
  resubmit: "填写补充依据并请收款方重新核对，金额和资金来源继续沿用原登记。",
  return: "只有原资金已经实际退回转出账户时，才可填写退回凭据并确认。"
};
const label = (key: string) => props.accounts.find(account => account.scopeKey === key)?.name ?? (key === "public_cash" ? "公共现金" : "原公司资金账户");
const hasBalance = (account: FundAccount) => account.active && account.currentRegistrationId !== null && account.balanceYuan !== null;
const cash = computed(() => props.accounts.find(account => account.kind === "public_cash" && hasBalance(account)));
const companies = computed(() => props.accounts.filter(account => account.kind === "company" && hasBalance(account)));
const companyOptions = computed(() => registrationAccounts.value.filter(account => account.kind === "company")
  .map(account => ({ label: account.name, value: account.scopeKey })));
const registrationCash = computed(() => registrationAccounts.value.find(account => account.kind === "public_cash"));
const company = computed(() => registrationAccounts.value.find(account => account.scopeKey === selectedCompany.value));
const origin = computed(() => direction.value === "cash" ? registrationCash.value : company.value);
const destination = computed(() => direction.value === "cash" ? company.value : registrationCash.value);
const eligibleSources = (account?: FundAccount) => (account?.sources ?? []).filter(
  (source): source is FundAvailableSource & { id: string; amountYuan: string } =>
    Boolean(source.id) && source.amountYuan !== null && /[1-9]/u.test(source.amountYuan) && !source.amountYuan.startsWith("-") && !source.pendingAllocation
);
const sourceRows = computed(() => eligibleSources(origin.value));
const sourceLabel = (source: FundAvailableSource) => {
  const project = source.projectStatus === "project"
    ? props.projects.find(item => item.id === source.projectId)?.name ?? "原登记项目"
    : source.projectStatus === "company_daily" ? "公司日常" : "项目归属待核对";
  return `${source.sourceName || "出资方待核对"} · ${project} · 可用 ¥${source.amountYuan}`;
};
const canTransferFrom = (scopeKey: string) => scopeKey === "public_cash"
  ? model.value?.canRegisterCash === true
  : model.value?.canRegisterCompany === true;
const registerAllowed = computed(() => Boolean(origin.value && canTransferFrom(origin.value.scopeKey)));
const actionAllowed = computed(() => {
  const selected = selectedAction.value;
  if (!selected) return false;
  const transfer = model.value?.transfers.find(row => row.id === selected.transfer.id && row.revision === selected.transfer.revision);
  return (selected.action === "resubmit" || selected.action === "return" ? transfer?.canResolveRejection : transfer?.canReceive) === true;
});
const recoveryAllowed = computed(() => {
  const command = pending.value;
  if (!command) return false;
  if (command.type === "register") return canTransferFrom(command.input.sourceScopeKey);
  const transfer = model.value?.transfers.find(row => row.id === command.transferId);
  if (!transfer) return false;
  const fromOrigin = command.input.action === "resubmit" || command.input.action === "return";
  return canTransferFrom(fromOrigin ? transfer.sourceScopeKey : transfer.destinationScopeKey);
});
const canDraft = computed(() => storageReady.value && !pending.value && !busy.value && !loading.value && !props.accountLoading);
const disabledRegister = computed(() => !canDraft.value || !cash.value || !companies.value.length);
const canDraftCompany = computed(() => companies.value.some(account => eligibleSources(account).length > 0));
let viewRevision = 0;

async function load() {
  const actor = actorId.value;
  const request = ++viewRevision;
  loading.value = true;
  error.value = "";
  try {
    const response = await fetchFundAccountTransfers();
    if (viewRevision === request && actorId.value === actor) model.value = response;
  } catch (failure) {
    if (viewRevision === request && actorId.value === actor) {
      model.value = null;
      error.value = formatUnknownApiError(failure, "转款记录读取失败，请刷新后重试");
    }
  } finally {
    if (viewRevision === request) loading.value = false;
  }
}

watch(actorId, actor => {
  viewRevision++;
  direction.value = null;
  selectedAction.value = null;
  model.value = null;
  pending.value = null;
  notice.value = "";
  error.value = "";
  storageReady.value = false;
  if (!actor) return;
  try {
    pending.value = readFundTransferCommand(actor);
    storageReady.value = Boolean(navigator.locks);
  } catch {
    storageReady.value = false;
  }
  void load();
}, { immediate: true });
onBeforeUnmount(() => { viewRevision++; });
watch(selectedCompany, () => { allocations.value = {}; });

function openRegistration(nextDirection: "cash" | "company") {
  if (disabledRegister.value || !(nextDirection === "cash" ? model.value?.canRegisterCash : model.value?.canRegisterCompany)) return;
  registrationAccounts.value = props.accounts.filter(hasBalance);
  direction.value = nextDirection;
  selectedCompany.value = "";
  reference.value = "";
  allocations.value = {};
  date.value = chinaDateOnly();
  error.value = "";
}
function openAction(transfer: FundTransfer, action: FundTransferAction) {
  if (!canDraft.value || !(action === "resubmit" || action === "return" ? transfer.canResolveRejection : transfer.canReceive)) return;
  selectedAction.value = { transfer, action };
  reference.value = "";
  error.value = "";
}
function closeForm() {
  if (busy.value) return;
  direction.value = null;
  selectedAction.value = null;
}
function submitRegistration() {
  const from = origin.value;
  const to = destination.value;
  if (!registerAllowed.value || !from?.currentRegistrationId || !to || !canDraft.value) return;
  if (![from, to].every(account => props.accounts.some(current =>
    current.scopeKey === account.scopeKey && hasBalance(current) && current.currentRegistrationId === account.currentRegistrationId))) {
    error.value = "账户的有效登记已变化，请保留原依据并重新选择账户和资金来源";
    return;
  }
  const lines = sourceRows.value.flatMap(source => {
    const amountYuan = allocations.value[source.id]?.trim();
    return amountYuan ? [{ sourceBatchId: source.id, amountYuan }] : [];
  });
  if (!reference.value.trim() || !date.value || !lines.length || lines.some(line =>
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/u.test(line.amountYuan) || !/[1-9]/u.test(line.amountYuan))) {
    error.value = "请填写转出日期、依据，并为所选来源填写大于零且最多四位小数的金额";
    return;
  }
  void submit({ type: "register", input: {
    sourceScopeKey: from.scopeKey, destinationScopeKey: to.scopeKey, expectedRegistrationId: from.currentRegistrationId,
    idempotencyKey: crypto.randomUUID(), transferredOn: date.value, evidenceReference: reference.value.trim(), lines
  } });
}
function submitAction() {
  if (!actionAllowed.value || !selectedAction.value || !canDraft.value) return;
  const { transfer, action } = selectedAction.value;
  if (!reference.value.trim()) { error.value = "请填写本次办理的实际依据或原因"; return; }
  void submit({ type: "action", transferId: transfer.id, input: {
    idempotencyKey: crypto.randomUUID(), expectedRevision: transfer.revision, action, evidenceReference: reference.value.trim()
  } });
}

function retryPending() {
  if (!recoveryAllowed.value) return;
  void submit(null);
}

async function submit(proposal: FundTransferCommand | null) {
  if (busy.value || !storageReady.value) return;
  const actor = actorId.value;
  const openedView = viewRevision;
  const expectedPending = proposal ? null : pending.value;
  const isCurrent = () => actorId.value === actor && openedView === viewRevision;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await submitFundTransferCommand(actor, proposal, isCurrent, expectedPending);
    if (!isCurrent()) return;
    if (result.kind === "rejected") {
      error.value = formatUnknownApiError(result.error, "转款未提交，请核对原资料");
      return;
    }
    direction.value = null;
    selectedAction.value = null;
    if (result.kind === "unknown" || result.kind === "pending") {
      pending.value = result.command;
      return;
    }
    pending.value = null;
    if (result.kind === "saved") notice.value = statusLabel[result.receipt.status];
    emit("refreshAccounts");
    await load();
    if (result.kind === "superseded" && actorId.value === actor && viewRevision === openedView + 1 && !error.value) {
      error.value = formatUnknownApiError(result.error, "转款已更新，请刷新后核对");
    }
  } catch (failure) {
    if (isCurrent()) error.value = formatUnknownApiError(failure, "原转款凭据尚未确认，请刷新后核对");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    class="fund-transfers"
    aria-label="资金转款"
  >
    <div class="fund-transfers__actions">
      <t-button
        v-if="model?.canRegisterCash"
        :disabled="disabledRegister || !eligibleSources(cash).length"
        @click="openRegistration('cash')"
      >
        现金转公司
      </t-button>
      <t-button
        v-if="model?.canRegisterCompany"
        :disabled="disabledRegister || !canDraftCompany"
        @click="openRegistration('company')"
      >
        公司转公共现金
      </t-button>
      <t-button
        variant="outline"
        :disabled="busy"
        :loading="loading"
        @click="load"
      >
        刷新转款记录
      </t-button>
    </div>
    <t-alert
      v-if="!storageReady && actorId"
      theme="warning"
      message="当前无法安全读取或保存原转款凭据，请保留浏览器记录并刷新后核对。"
    />
    <t-alert
      v-if="notice"
      theme="success"
      :message="notice"
    />
    <t-alert
      v-if="error && !direction && !selectedAction"
      theme="error"
      :message="error"
    />
    <t-card
      v-if="pending"
      title="原转款结果待核对"
    >
      <p>原内容和办理凭据已保留。使用原凭据获取结果，避免再次登记。</p>
      <t-button
        :loading="busy"
        :disabled="!recoveryAllowed || !storageReady || loading"
        @click="retryPending"
      >
        使用原凭据继续核对
      </t-button>
    </t-card>
    <t-alert
      v-else-if="model && (model.canRegisterCash || model.canRegisterCompany) && (!cash || !companies.length)"
      theme="info"
      message="两端均须有已核对的有效资金账户，未知余额请先核对。"
    />
    <template v-if="model">
      <t-empty
        v-if="!model.transfers.length"
        description="暂无转款记录"
      />
      <t-card
        v-for="transfer in model.transfers"
        :key="transfer.id"
        :title="`${label(transfer.sourceScopeKey)} → ${label(transfer.destinationScopeKey)}`"
      >
        <p>{{ transfer.transferredOn }} · ¥{{ transfer.amountYuan }} · {{ statusLabel[transfer.status] }}</p>
        <p v-if="transfer.status === 'pending_receipt' || transfer.status === 'rejected_held'">
          转出资金已占用，收款账户尚未增加可用余额。
        </p>
        <p>转出依据：{{ transfer.evidenceReference }}</p>
        <ul v-if="transfer.actions.some(item => item.action !== 'register')">
          <li
            v-for="item in transfer.actions.filter(entry => entry.action !== 'register')"
            :key="item.createdAt + item.action"
          >
            {{ actionLabel[item.action] }} · {{ chinaDateTimeInput(new Date(item.createdAt)) }} · {{ item.evidenceReference }}
          </li>
        </ul>
        <DutySmsStatusPanel
          v-if="actorId && (transfer.canReceive || transfer.canResolveRejection)"
          :key="`${actorId}:${transfer.id}:${transfer.revision}`"
          domain="fund-account-transfers"
          :business-id="transfer.id"
        />
        <div
          v-if="transfer.canReceive || transfer.canResolveRejection"
          class="fund-transfers__actions"
        >
          <template v-if="transfer.canReceive">
            <t-button
              :disabled="!canDraft"
              @click="openAction(transfer, 'confirm')"
            >
              确认实收
            </t-button>
            <t-button
              variant="outline"
              :disabled="!canDraft"
              @click="openAction(transfer, 'reject')"
            >
              驳回待核对
            </t-button>
          </template>
          <template v-if="transfer.canResolveRejection">
            <t-button
              :disabled="!canDraft"
              @click="openAction(transfer, 'resubmit')"
            >
              补充依据并重提
            </t-button>
            <t-button
              variant="outline"
              :disabled="!canDraft"
              @click="openAction(transfer, 'return')"
            >
              确认实际退回
            </t-button>
          </template>
        </div>
      </t-card>
    </template>
    <t-dialog
      v-if="direction"
      :visible="true"
      :header="direction === 'cash' ? '登记现金转公司' : '登记公司转公共现金'"
      width="var(--jg-layout-form-max-width)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: '登记转出', disabled: !registerAllowed || !canDraft || !destination || !sourceRows.length, loading: busy }"
      :cancel-btn="{ content: '取消', disabled: busy }"
      @confirm="submitRegistration"
      @close="closeForm"
    >
      <div class="fund-transfers__form">
        <label>
          {{ direction === 'cash' ? '收款公司' : '转出公司' }}
          <t-select
            v-model="selectedCompany"
            aria-label="选择公司"
            :options="companyOptions"
            :disabled="busy"
          />
        </label>
        <label>
          转出日期
          <t-date-picker
            v-model="date"
            value-type="YYYY-MM-DD"
            aria-label="转出日期"
            :disabled="busy"
          />
        </label>
        <label
          v-for="source in sourceRows"
          :key="source.id"
        >
          {{ sourceLabel(source) }}
          <t-input
            v-model="allocations[source.id]"
            :aria-label="`转出金额：${sourceLabel(source)}`"
            inputmode="decimal"
            placeholder="未使用的来源留空"
            :disabled="busy"
          />
        </label>
        <p v-if="origin && !sourceRows.length">
          当前账户没有可明确分摊的资金来源，请先核对来源。
        </p>
        <label>
          转出依据
          <t-textarea
            v-model="reference"
            aria-label="转出依据"
            :maxlength="1000"
            :disabled="busy"
          />
        </label>
        <t-alert
          v-if="error"
          theme="error"
          :message="error"
        />
      </div>
    </t-dialog>
    <t-dialog
      v-if="selectedAction"
      :visible="true"
      :header="actionLabel[selectedAction.action]"
      width="var(--jg-layout-form-max-width)"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: actionLabel[selectedAction.action], loading: busy, disabled: !actionAllowed || !canDraft }"
      :cancel-btn="{ content: '取消', disabled: busy }"
      @confirm="submitAction"
      @close="closeForm"
    >
      <p>{{ label(selectedAction.transfer.sourceScopeKey) }} → {{ label(selectedAction.transfer.destinationScopeKey) }} · ¥{{ selectedAction.transfer.amountYuan }}</p>
      <p>{{ actionPrompt[selectedAction.action] }}</p>
      <label>
        办理依据
        <t-textarea
          v-model="reference"
          :maxlength="1000"
          :disabled="busy"
        />
      </label>
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
    </t-dialog>
  </section>
</template>

<style scoped>
.fund-transfers, .fund-transfers__form { display: grid; gap: var(--jg-space-md); margin-top: var(--jg-space-lg); min-width: 0; }
.fund-transfers__form label { display: grid; gap: var(--jg-space-xs); }
.fund-transfers__actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-sm); }
p, li { overflow-wrap: anywhere; }
</style>
