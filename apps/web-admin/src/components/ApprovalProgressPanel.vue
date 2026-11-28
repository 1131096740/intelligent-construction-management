<script setup lang="ts">
import { ref, watch } from "vue";
import { useAuthStore } from "../auth/auth.store";
import DutySmsStatusPanel from "./DutySmsStatusPanel.vue";
import ApprovalDocumentDownload from "./approval/ApprovalDocumentDownload.vue";
import { fetchApprovalProgress, fetchRelatedApprovals, remindApprovalBySms, ApprovalProgressApiError, type ApprovalProgress, type ApprovalPerson } from "../api/approval-progress.api";

const props = defineProps<{ instanceId?: string; businessType?: string; businessId?: string; refreshKey?: string; viewer?: boolean }>();
const auth = useAuthStore();
const transitionSmsTypes = new Set([
  "project_expense_request", "project_financing_quota", "project_settlement_exception_quota", "fund_execution_case"
]);
const correctionStatuses = new Set(["rejected", "returned", "returned_to_applicant"]);
const progressView = () => props.viewer ? "viewable" as const : "participant" as const;
const flows = ref<ApprovalProgress[]>([]);
const loading = ref(false);
const sending = ref(false);
const error = ref("");
let generation = 0;
const requests = new Map<string, { requestId: string; reminderToken: string; recipientIds: string[] }>();
const selections = ref<Record<string, { token: string; recipientIds: string[] }>>({});
const names = (people: ApprovalPerson[]) => people.map(p => p.name).join("、") || "暂无有效人员";
const time = (value: string) => new Date(value).toLocaleString("zh-CN");

async function load() {
  const own = ++generation;
  flows.value = [];
  error.value = "";
  loading.value = true;
  try {
    const result: ApprovalProgress[] = [];
    if (props.instanceId) result.push(await fetchApprovalProgress(props.instanceId, progressView()));
    else if (props.businessType && props.businessId) {
      let cursor: string | undefined;
      do {
        const page = await fetchRelatedApprovals({ businessType: props.businessType, businessId: props.businessId, cursor, view: progressView() });
        if (own !== generation) return;
        result.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    if (own === generation) {
      for (const flow of result) {
        const request = requests.get(flow.id);
        if (request && flow.reminders.some(reminder => reminder.id === request.requestId)) requests.delete(flow.id);
      }
      flows.value = result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  } catch (cause) { if (own === generation) error.value = cause instanceof Error ? cause.message : "审批进度读取失败"; }
  finally { if (own === generation) loading.value = false; }
}

function isOwnPendingDuty(flow: ApprovalProgress, node: ApprovalProgress["nodes"][number]) {
  return !flow.viewerOnly && flow.canHandle && node.pending.some(person => person.id === auth.user?.id);
}

function isOwnCorrection(flow: ApprovalProgress) {
  return !flow.viewerOnly && correctionStatuses.has(flow.status) && flow.applicant.id === auth.user?.id;
}

function eligibleRecipients(flow: ApprovalProgress) {
  return flow.remindableRecipients ?? flow.pendingRecipients;
}

function selectedRecipients(flow: ApprovalProgress) {
  const selection = selections.value[flow.id];
  return eligibleRecipients(flow).filter(user => selection?.token !== flow.reminderToken || selection.recipientIds.includes(user.id));
}

function selectRecipients(flow: ApprovalProgress, values: Array<string | number>) {
  selections.value[flow.id] = { token: flow.reminderToken, recipientIds: values.map(String) };
}

class ReminderStateChangedError extends Error {}

async function sendReminderWithCapability(instanceId: string, requestId: string, reminderToken: string, recipientIds: string[]) {
  const capability = await fetchApprovalProgress(instanceId);
  const operationAllowed = capability.canRemind;
  if (!operationAllowed) throw new ReminderStateChangedError("审批状态已变化，请刷新进度");
  // Keep the recipient version confirmed on screen; the POST rejects any intervening change.
  return remindApprovalBySms(instanceId, requestId, reminderToken, recipientIds);
}

async function remind(flow: ApprovalProgress) {
  if (sending.value || !flow.canRemind) return;
  const recipientIds = selectedRecipients(flow).map(user => user.id);
  if (!recipientIds.length) return;
  const own = generation;
  sending.value = true;
  error.value = "";
  // Retain the key on network failure, so retrying an uncertain response cannot send again.
  const request = requests.get(flow.id) ?? { requestId: crypto.randomUUID(), reminderToken: flow.reminderToken, recipientIds };
  requests.set(flow.id, request);
  try {
    const result = await sendReminderWithCapability(flow.id, request.requestId, request.reminderToken, request.recipientIds);
    if (result.reminders.some(reminder => reminder.id === request.requestId)) requests.delete(flow.id);
    if (own === generation) flows.value = flows.value.map(item => item.id === result.id ? result : item);
  } catch (cause) {
    if (cause instanceof ReminderStateChangedError) {
      // Cooldown may belong to this uncertain request. Refresh before deciding whether its key can be cleared.
      await load();
      return;
    }
    // A conflict rejects the reservation. A network/server error can follow a send, so retain that key.
    if (cause instanceof ApprovalProgressApiError && cause.status === 409) requests.delete(flow.id);
    if (own === generation) error.value = cause instanceof Error ? cause.message : "催办结果待确认，请刷新查看记录";
  } finally { sending.value = false; }
}

watch(() => [props.instanceId, props.businessType, props.businessId, props.refreshKey, props.viewer], () => { void load(); }, { immediate: true });
</script>

<template>
  <section
    class="approval-progress"
    aria-label="完整审批进度"
  >
    <div class="approval-progress__head">
      <h2>完整审批进度</h2>
      <t-button
        variant="text"
        :loading="loading"
        :disabled="sending"
        @click="load"
      >
        刷新进度
      </t-button>
    </div>
    <t-alert
      v-if="error"
      theme="error"
      :message="error"
    />
    <p v-if="loading">
      正在读取审批进度…
    </p>
    <p v-else-if="!flows.length && !error">
      暂无已提交且与你相关的审批流程。
    </p>
    <article
      v-for="flow in flows"
      :key="flow.id"
      class="approval-progress__flow"
    >
      <h3>{{ flow.title }} · {{ flow.businessCode }}</h3>
      <p>{{ flow.projectName }} · {{ flow.applicant.name }}发起 · {{ time(flow.createdAt) }}</p>
      <p><strong>当前：{{ flow.currentNodeName }}</strong><span v-if="flow.pendingRecipients.length"> · 等待{{ names(flow.pendingRecipients) }}</span></p>
      <p v-if="flow.parallelCompletion">
        并联完成 {{ flow.parallelCompletion.completed }}/{{ flow.parallelCompletion.total }} 项职责
      </p>
      <p v-if="flow.viewerOnly">
        你当前只有查看权，没有办理按钮；办理仍在业务详情页由当前有效职责完成。
      </p>
      <ol class="approval-progress__nodes">
        <li
          v-for="(node, index) in flow.nodes"
          :key="index"
        >
          <strong>{{ index + 1 }}. {{ node.name }} · {{ node.status }}</strong>
          <p>{{ node.mode }} · {{ names(node.participants) }}</p>
          <p v-if="node.pending.length">
            待处理：{{ names(node.pending) }}
          </p>
          <p v-if="node.signatures?.length">
            已签字：{{ node.signatures.map(signature => `${signature.name}（${time(signature.signedAt)}）`).join('、') }}
          </p>
          <p v-else-if="flow.status === 'in_progress' || flow.status === 'approval_pending'">
            未签（审批中，审批单对应位置留空）
          </p>
          <small v-if="node.legacyRoster">此历史节点未保存人员名单，以上为当前岗位人员；实际处理人以处理记录为准。</small>
          <DutySmsStatusPanel
            v-if="flow.businessType === 'expense_claim' && isOwnPendingDuty(flow, node)"
            domain="expense-claim-approvals"
            :business-id="flow.businessId"
            :expected-approval-instance-id="flow.id"
            :duty-key="String(index)"
            :label="`${node.name}待办短信`"
          />
          <DutySmsStatusPanel
            v-if="transitionSmsTypes.has(flow.businessType) && index === flow.currentNodeIndex && isOwnPendingDuty(flow, node)"
            domain="approval-progress"
            :business-id="flow.id"
            :label="`${node.name}待办短信`"
          />
        </li>
      </ol>
      <DutySmsStatusPanel
        v-if="flow.businessType === 'expense_claim' && isOwnCorrection(flow)"
        domain="expense-claim-approvals"
        :business-id="flow.businessId"
        :expected-approval-instance-id="flow.id"
        label="退回修改短信"
      />
      <DutySmsStatusPanel
        v-if="transitionSmsTypes.has(flow.businessType) && isOwnCorrection(flow)"
        domain="approval-progress"
        :business-id="flow.id"
        label="退回修改短信"
      />
      <div
        v-if="flow.businessType && flow.businessId"
        class="approval-progress__document"
      >
        <ApprovalDocumentDownload
          :business-type="flow.businessType"
          :business-id="flow.businessId"
          :approval-instance-id="flow.businessType === 'expense_claim' ? flow.id : undefined"
          :refresh-key="`${flow.id}:${flow.status}`"
        />
        <small>当前轮审批单：已签节点显示签字，未签留空；办理中下载带水印并记录下载。</small>
      </div>
      <t-checkbox-group
        v-if="flow.canRemind && eligibleRecipients(flow).length > 1"
        :value="selectedRecipients(flow).map(user => user.id)"
        :options="eligibleRecipients(flow).map(user => ({label: user.name, value: user.id}))"
        :disabled="sending"
        aria-label="选择催办对象"
        @change="selectRecipients(flow, $event)"
      />
      <t-popconfirm
        :content="`向${names(selectedRecipients(flow))}发送审批催办短信？`"
        confirm-btn="发送短信"
        @confirm="remind(flow)"
      >
        <t-button
          theme="primary"
          :disabled="!flow.canRemind || !selectedRecipients(flow).length || sending"
          :loading="sending"
        >
          短信催办
        </t-button>
      </t-popconfirm>
      <p v-if="flow.reminderUnavailableReason">
        {{ flow.reminderUnavailableReason }}<span v-if="flow.nextRemindAt">（下次可催办：{{ time(flow.nextRemindAt) }}）</span>
      </p>
      <details
        v-if="flow.history.length"
        open
      >
        <summary>处理记录</summary>
        <ul>
          <li
            v-for="entry in flow.history"
            :key="entry.id"
          >
            {{ time(entry.createdAt) }} · {{ entry.actor.name }} · {{ entry.action }}<span v-if="entry.comment">：{{ entry.comment }}</span>
          </li>
        </ul>
      </details>
      <details
        v-if="flow.reminders.length"
        open
      >
        <summary>短信催办记录</summary>
        <ul>
          <li
            v-for="entry in flow.reminders"
            :key="entry.id"
          >
            {{ time(entry.createdAt) }} · {{ entry.actor.name }}催办{{ names(entry.recipients) }}
            <p v-if="entry.pending">
              发送结果待确认，请勿重复发送。
            </p>
            <p
              v-for="result in entry.results"
              :key="result.userId"
            >
              {{ entry.recipients.find(p => p.id === result.userId)?.name }}：{{ result.message }}
            </p>
          </li>
        </ul>
      </details>
    </article>
  </section>
</template>

<style scoped>
.approval-progress { display: grid; gap: var(--jg-space-lg); min-width: 0; padding: var(--jg-space-lg); background: var(--jg-color-bg-panel); border: 1px solid var(--jg-color-border); border-radius: var(--jg-radius-md); overflow-wrap: anywhere; }
.approval-progress__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--jg-space-sm); }
.approval-progress__head h2 { margin: 0; font-size: 18px; }
.approval-progress__flow { min-width: 0; border-top: 1px solid var(--jg-color-border); }
.approval-progress__nodes { display: grid; gap: var(--jg-space-md); padding: 0; list-style: none; }
.approval-progress__nodes li { border-left: 3px solid var(--jg-color-brand); padding-left: var(--jg-space-md); }
.approval-progress p { margin: var(--jg-space-sm) 0; }
.approval-progress small { color: var(--jg-color-text-secondary); }
.approval-progress__document { display: grid; gap: var(--jg-space-xs); align-items: start; }
.approval-progress details { margin-top: var(--jg-space-md); }
.approval-progress ul { padding-left: var(--jg-space-lg); }
</style>
