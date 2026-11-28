<script setup lang="ts">
import { chinaDateOnly, normalizeBusinessAmount, sumBusinessAmounts } from "@jiangkong/shared-domain";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  fetchPrincipalReturns,
  type PrincipalReturnAction,
  type PrincipalReturnApplication,
  type PrincipalReturnCommand,
  type PrincipalReturnSource,
} from "../../api/fund-principal-return.api";
import DutySmsStatusPanel from "../../components/DutySmsStatusPanel.vue";
import { fetchFundAccounts, type FundAccount } from "../../api/fund-account.api";
import { formatUnknownApiError } from "../../api/error-message";
import { useAuthStore } from "../../auth/auth.store";
import { roleLabels } from "../settings/approval-flow-readonly.config";
import { readPrincipalReturnCommand, runPrincipalReturnCommand } from "./principal-return-command";

const props = defineProps<{ accounts?: FundAccount[]; accountLoading?: boolean; applicationId?: string }>();
const emit = defineEmits<{ refreshAccounts: [] }>();
const auth = useAuthStore();
const actorId = computed(() => auth.user?.id ?? "");
const actorScope = computed(() => JSON.stringify([actorId.value, auth.user?.roleKeys, auth.user?.globalRoleKeys]));
let actorVersion = 0;
onBeforeUnmount(() => { actorVersion++; });
const model = ref<Awaited<ReturnType<typeof fetchPrincipalReturns>>>();
const loading = ref(false);
const detailAccounts = ref<FundAccount[]>([]);
const accounts = computed(() => props.accounts ?? detailAccounts.value);
const visibleSources = computed(() => {
  const selectedId = props.applicationId;
  return (model.value?.items ?? []).flatMap(source => {
    if (!selectedId) return [source];
    const applications = source.applications.filter(application => application.id === selectedId);
    return applications.length ? [{ ...source, canApply: false, applications }] : [];
  });
});
const busy = ref(false);
const storageReady = ref(false);
const error = ref("");
const notice = ref("");
const pending = ref<PrincipalReturnCommand | null>(null);
const recoveryPassword = ref("");
const statusNames = {
  pending: "审批中", approved: "已批准待付", partially_paid: "部分已付", paid: "已付清", rejected: "已驳回", withdrawn: "已撤回",
};
const actionNames = { approve: "同意", reject: "驳回", withdraw: "撤回", reduce: "核减批准金额", pay: "登记实际归还", apply: "发起归还申请" };
type Selection =
  | { kind: "apply"; source: PrincipalReturnSource }
  | { kind: "act"; application: PrincipalReturnApplication; action: PrincipalReturnAction; nodeIndex?: number; requiresSelfPassword?: boolean }
  | { kind: "pay"; application: PrincipalReturnApplication };
const selected = ref<Selection | null>(null);
const needsPassword = computed(() => selected.value?.kind === "pay" ||
  (selected.value?.kind === "act" && (selected.value.action === "reduce" || selected.value.requiresSelfPassword)));
const pendingNeedsPassword = computed(() => pending.value?.kind === "pay" ||
  (pending.value?.kind === "act" && pending.value.requiresPassword));
const dialogTitle = computed(() => selected.value?.kind === "act"
  ? actionNames[selected.value.action] : actionNames[selected.value?.kind ?? "apply"]);
const form = reactive({ amount: "", scopeKey: "", paidOn: chinaDateOnly(), note: "", password: "" });
const allocations = ref<Record<string, string>>({});
const payerRegistrationId = ref<string | null>(null);
const payerAccounts = computed(() => accounts.value.filter(account => account.active && account.currentRegistrationId &&
  account.balanceYuan !== null && model.value?.payableScopeKeys.includes(account.scopeKey)));
const payer = computed(() => payerAccounts.value.find(account => account.scopeKey === form.scopeKey));
const sources = computed(() => (payer.value?.sources ?? []).filter(source => source.id &&
  source.amountYuan !== null && normalizeBusinessAmount(source.amountYuan) !== "0.0000"));
watch(() => form.scopeKey, () => {
  payerRegistrationId.value = payer.value?.currentRegistrationId ?? null;
  allocations.value = {};
});
function remainingPrincipal(source: PrincipalReturnSource) {
  const paid = source.paidYuan === null ? null : `-${source.paidYuan}`;
  const remaining = sumBusinessAmounts([source.principalYuan, paid]);
  return remaining === null ? "待核对" : `¥${remaining}`;
}
const accountName = (scope: string) => accounts.value.find(row => row.scopeKey === scope)?.name ??
  (scope === "public_cash" ? "公共现金" : "原公司资金账户");

let version = 0;
async function load() {
  const token = ++version;
  const scopeVersion = actorVersion;
  const isCurrent = () => token === version && scopeVersion === actorVersion;
  loading.value = true;
  try {
    const result = await fetchPrincipalReturns(isCurrent);
    if (!isCurrent()) return;
    model.value = result;
    if (props.applicationId && result.payableScopeKeys.length && visibleSources.value.some(source => source.applications.some(row => row.canPay))) {
      const balances = await fetchFundAccounts(isCurrent);
      if (isCurrent()) detailAccounts.value = balances.accounts;
    }
  } catch (failure) {
    if (isCurrent()) error.value = formatUnknownApiError(failure, "待归还账读取失败，请刷新重试");
  } finally {
    if (isCurrent()) loading.value = false;
  }
}

watch(actorScope, () => {
  const actor = actorId.value;
  actorVersion++;
  model.value = undefined;
  detailAccounts.value = [];
  loading.value = false;
  busy.value = false;
  error.value = "";
  notice.value = "";
  selected.value = null;
  form.password = "";
  recoveryPassword.value = "";
  storageReady.value = false;
  pending.value = null;
  if (!actor) return;
  try {
    pending.value = readPrincipalReturnCommand(actor);
    storageReady.value = Boolean(navigator.locks);
    if (!storageReady.value) error.value = "当前浏览器无法安全保存归还凭据";
  } catch (failure) {
    error.value = formatUnknownApiError(failure, "原归还凭据无法读取，请保留浏览器记录");
  }
  void load();
}, { immediate: true, flush: "sync" });

function open(selection: Selection) {
  if (busy.value || pending.value || !storageReady.value) return;
  error.value = "";
  notice.value = "";
  Object.assign(form, { amount: "", scopeKey: "", paidOn: chinaDateOnly(), note: "", password: "" });
  allocations.value = {};
  selected.value = selection;
}
function close() {
  if (busy.value) return;
  selected.value = null;
  form.password = "";
}
function positiveAmount(input: string) {
  const normalized = normalizeBusinessAmount(input.trim());
  if (!normalized || normalized === "0.0000") throw new Error("金额必须大于零");
  return normalized;
}
function makeCommand(selection: Selection): PrincipalReturnCommand {
  const idempotencyKey = crypto.randomUUID();
  const note = form.note.trim();
  if (!note) throw new Error("请填写办理说明或实付凭据");
  if (selection.kind === "apply") {
    const { sourceKind, sourceId } = selection.source;
    return { idempotencyKey, kind: "apply", input: { sourceKind, sourceId, amountYuan: positiveAmount(form.amount), reason: note } };
  }
  const { id: applicationId, revision: expectedRevision } = selection.application;
  if (needsPassword.value && !form.password) throw new Error("请输入确认密码");
  if (selection.kind === "act") {
    return { idempotencyKey, kind: "act", applicationId, requiresPassword: Boolean(needsPassword.value), input: {
      action: selection.action, expectedRevision, nodeIndex: selection.nodeIndex, reason: note,
      reducedYuan: selection.action === "reduce" ? positiveAmount(form.amount) : undefined,
    } };
  }
  const currentAccount = payer.value;
  if (!currentAccount?.currentRegistrationId || !form.paidOn || props.accountLoading) throw new Error("请核对实际付款账户及归还日期");
  if (currentAccount.currentRegistrationId !== payerRegistrationId.value) throw new Error("原有效登记已变化，请重新选择并核对付款账户");
  const amountYuan = positiveAmount(form.amount);
  const sourceAllocations = sources.value.flatMap(({ id }) => {
    const rawAmount = allocations.value[id!] || "";
    return rawAmount.trim() ? [{ sourceBatchId: id!, amountYuan: positiveAmount(rawAmount) }] : [];
  });
  if (sumBusinessAmounts(sourceAllocations.map(line => line.amountYuan)) !== amountYuan) throw new Error("各来源分配合计必须等于实际归还金额");
  return { idempotencyKey, kind: "pay", applicationId, input: {
    expectedRevision, scopeKey: currentAccount.scopeKey, expectedRegistrationId: currentAccount.currentRegistrationId,
    paidOn: form.paidOn, amountYuan, sourceAllocations, evidenceReference: note,
  } };
}

async function run(command: PrincipalReturnCommand, mode: "new" | "check" | "retry", password = "") {
  if (busy.value || !storageReady.value) return;
  const actor = actorId.value;
  const scopeVersion = actorVersion;
  const isCurrent = () => scopeVersion === actorVersion;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await runPrincipalReturnCommand(actor, command, mode, isCurrent, password);
    if (!isCurrent()) return;
    if (result.kind === "pending") {
      pending.value = result.command;
      selected.value = null;
      notice.value = "原办理结果待核对。请查询回执，或使用原内容继续办理。";
    } else if (result.kind === "rejected") {
      error.value = formatUnknownApiError(result.error, "归还办理未提交，请核对原资料");
      void load();
    } else {
      pending.value = null;
      selected.value = null;
      notice.value = result.kind === "recorded" ? "已核对到归还办理回执" : "本机原凭据已由其他页面处理，请查看最新待归还账";
      if (command.kind === "pay") emit("refreshAccounts");
      void load();
    }
  } catch (failure) {
    if (isCurrent()) error.value = formatUnknownApiError(failure, "原凭据无法安全处理，请保留浏览器记录");
  } finally {
    if (isCurrent()) busy.value = false;
  }
}

function submit() {
  if (!selected.value || busy.value) return;
  try {
    const command = makeCommand(selected.value);
    const password = form.password;
    form.password = "";
    void run(command, "new", password);
  } catch (failure) {
    error.value = formatUnknownApiError(failure, "请核对办理内容");
  }
}
function recover(mode: "check" | "retry") {
  if (!pending.value || busy.value) return;
  const password = recoveryPassword.value;
  if (mode === "retry" && pendingNeedsPassword.value && !password) {
    error.value = "请重新输入确认密码";
    return;
  }
  recoveryPassword.value = "";
  void run(pending.value, mode, password);
}
function checkOriginal() { recover("check"); }
function retryOriginal() { recover("retry"); }
function dutyName(keys: string[]) {
  return keys.flatMap(key => key in roleLabels ? [roleLabels[key as keyof typeof roleLabels]] : []).join("、") || "本次审批职责";
}
</script>

<template>
  <section class="principal-returns">
    <t-alert
      v-if="error && !selected"
      theme="error"
      :message="error"
    />
    <t-alert
      v-if="notice"
      theme="info"
      :message="notice"
    />
    <t-card
      v-if="pending"
      title="原归还办理待核对"
    >
      <p>请先核对原回执。需要继续办理时沿用原登记内容。</p>
      <t-input
        v-if="pendingNeedsPassword"
        v-model="recoveryPassword"
        type="password"
        placeholder="重试时输入确认密码"
        autocomplete="off"
      />
      <div class="principal-returns__actions">
        <t-button
          variant="outline"
          :disabled="busy"
          @click="checkOriginal"
        >
          查询原回执
        </t-button>
        <t-button
          :loading="busy"
          @click="retryOriginal"
        >
          按原内容重试
        </t-button>
      </div>
    </t-card>
    <t-button
      variant="outline"
      :loading="loading"
      @click="load"
    >
      刷新待归还账
    </t-button>
    <p v-if="model && !visibleSources.length">
      {{ applicationId ? '当前没有可查看的归还申请。' : '当前没有可查看的垫资本金。' }}
    </p>
    <t-card
      v-for="source in visibleSources"
      :key="`${source.sourceKind}:${source.sourceId}`"
      :title="source.contributorName"
    >
      <p>{{ source.projectName || (source.projectId ? '原登记项目' : '公司日常（不属于项目）') }}</p>
      <div
        v-if="!source.delegatedOnly"
        class="principal-returns__amounts"
      >
        <span>原本金 ¥{{ source.principalYuan }}</span>
        <span>已还 ¥{{ source.paidYuan }}</span>
        <span>剩余本金 {{ remainingPrincipal(source) }}</span>
        <span>在途 ¥{{ source.reservedYuan }}</span>
        <span>可申请 ¥{{ source.availableYuan }}</span>
      </div>
      <router-link
        v-if="source.sourceKind === 'proxy_payment' && !source.delegatedOnly"
        :to="{ path: '/公司互转台账', query: { projectId: source.projectId ?? undefined, originalInterEntityRelationshipId: source.sourceId, view: 'history' } }"
      >
        查看公司代付归还
      </router-link>
      <t-button
        v-if="source.canApply"
        :disabled="!storageReady || busy || !!pending"
        @click="open({ kind: 'apply', source })"
      >
        发起归还申请
      </t-button>
      <div
        v-for="application in source.applications"
        :key="application.id"
        class="principal-returns__application"
      >
        <p>
          <strong>{{ statusNames[application.status] }}</strong> · 申请 ¥{{ application.requestedYuan }}<template v-if="application.approvedYuan !== null">
            · 批准 ¥{{ application.approvedYuan }}
          </template> · 已付 ¥{{ application.paidYuan }}
        </p>
        <ul v-if="application.payments.length">
          <li
            v-for="payment in application.payments"
            :key="payment.id"
          >
            {{ payment.paidOn }} · {{ accountName(payment.scopeKey) }} · ¥{{ payment.amountYuan }} · {{ payment.evidenceReference }}
            <ul v-if="payment.sourceAllocations?.length">
              <li
                v-for="line in payment.sourceAllocations"
                :key="line.sourceBatchId"
              >
                {{ line.sourceLabel }} · ¥{{ line.amountYuan }}
              </li>
            </ul>
          </li>
        </ul>
        <div class="principal-returns__actions">
          <template
            v-for="duty in application.approvalDuties"
            :key="duty.nodeIndex"
          >
            <t-button
              variant="outline"
              :disabled="!storageReady || busy || !!pending"
              @click="open({ kind: 'act', application, action: 'approve', nodeIndex: duty.nodeIndex, requiresSelfPassword: duty.requiresSelfPassword })"
            >
              同意（{{ dutyName(duty.roleKeys) }}）
            </t-button>
            <t-button
              variant="outline"
              :disabled="!storageReady || busy || !!pending"
              @click="open({ kind: 'act', application, action: 'reject', nodeIndex: duty.nodeIndex, requiresSelfPassword: duty.requiresSelfPassword })"
            >
              驳回（{{ dutyName(duty.roleKeys) }}）
            </t-button>
            <DutySmsStatusPanel
              v-if="actorId"
              :key="`${actorId}:${application.id}:review-${duty.nodeIndex}`"
              domain="fund-accounts/principal-returns"
              :business-id="application.id"
              :duty-key="`review-${duty.nodeIndex}`"
            />
          </template>
          <DutySmsStatusPanel
            v-if="actorId && application.canPay"
            :key="`${actorId}:${application.id}:pay`"
            domain="fund-accounts/principal-returns"
            :business-id="application.id"
            duty-key="pay"
          />
          <t-button
            v-if="application.canWithdraw"
            variant="outline"
            :disabled="!storageReady || busy || !!pending"
            @click="open({ kind: 'act', application, action: 'withdraw' })"
          >
            撤回
          </t-button>
          <t-button
            v-if="application.canReduce"
            variant="outline"
            :disabled="!storageReady || busy || !!pending"
            @click="open({ kind: 'act', application, action: 'reduce' })"
          >
            核减批准金额
          </t-button>
          <t-button
            v-if="application.canPay"
            :disabled="!storageReady || busy || !!pending || !payerAccounts.length"
            @click="open({ kind: 'pay', application })"
          >
            登记实际归还
          </t-button>
        </div>
      </div>
    </t-card>
    <t-dialog
      :visible="!!selected"
      :header="dialogTitle"
      :confirm-btn="{ content: dialogTitle, loading: busy }"
      :close-on-overlay-click="false"
      @confirm="submit"
      @close="close"
    >
      <t-alert
        v-if="error"
        theme="error"
        :message="error"
      />
      <t-form
        v-if="selected"
        label-align="top"
        @submit.prevent="submit"
      >
        <t-form-item
          v-if="selected.kind !== 'act' || selected.action === 'reduce'"
          :label="selected.kind === 'act' ? '核减后的批准总额（元）' : '金额（元）'"
        >
          <t-input
            v-model="form.amount"
            placeholder="最多四位小数"
            inputmode="decimal"
          />
        </t-form-item>
        <template v-if="selected.kind === 'pay'">
          <t-form-item label="实际付款账户">
            <t-select
              v-model="form.scopeKey"
              :options="payerAccounts.map(account => ({ value: account.scopeKey, label: account.name }))"
            />
          </t-form-item>
          <t-form-item label="实际归还日期">
            <t-date-picker
              v-model="form.paidOn"
              format="YYYY-MM-DD"
              value-type="YYYY-MM-DD"
            />
          </t-form-item>
          <p v-if="payer && !sources.length">
            该账户没有已知可分配金额的来源。
          </p>
          <t-form-item
            v-for="(source, index) in sources"
            :key="source.id"
            :label="`来源 ${index + 1} · ${source.sourceName || '待核对来源'} · 可用 ¥${source.amountYuan}`"
          >
            <t-input
              v-model="allocations[source.id!]"
              placeholder="本次使用金额（元）"
              inputmode="decimal"
            />
          </t-form-item>
        </template>
        <t-form-item :label="selected.kind === 'pay' ? '实付凭据' : '办理说明'">
          <t-textarea v-model="form.note" />
        </t-form-item>
        <t-form-item
          v-if="needsPassword"
          label="确认密码"
        >
          <t-input
            v-model="form.password"
            type="password"
            autocomplete="off"
          />
        </t-form-item>
      </t-form>
    </t-dialog>
  </section>
</template>

<style scoped>
.principal-returns { display: grid; gap: var(--jg-space-lg); justify-items: start; }
.principal-returns :deep(.t-card) { width: 100%; }
.principal-returns__amounts, .principal-returns__actions { display: flex; flex-wrap: wrap; gap: var(--jg-space-md); margin-block: var(--jg-space-md); }
.principal-returns__application { padding-block: var(--jg-space-sm); border-top: var(--jg-border-width-base) solid var(--jg-border); }
</style>
