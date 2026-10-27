<script setup lang="ts">
import { ref, watch } from "vue";
import { fetchApprovalProgress, fetchRelatedApprovals, remindApprovalBySms, ApprovalProgressApiError, type ApprovalProgress, type ApprovalPerson } from "../api/approval-progress.api";

const props = defineProps<{ instanceId?: string; businessType?: string; businessId?: string; refreshKey?: string }>();
const flows = ref<ApprovalProgress[]>([]);
const loading = ref(false);
const sending = ref(false);
const error = ref("");
let generation = 0;
const requests = new Map<string, { requestId: string; reminderToken: string }>();
const names = (people: ApprovalPerson[]) => people.map(p => p.name).join("、") || "暂无有效人员";
const time = (value: string) => new Date(value).toLocaleString("zh-CN");

async function load() {
  const own = ++generation;
  flows.value = [];
  error.value = "";
  loading.value = true;
  try {
    const result: ApprovalProgress[] = [];
    if (props.instanceId) result.push(await fetchApprovalProgress(props.instanceId));
    else if (props.businessType && props.businessId) {
      let cursor: string | undefined;
      do {
        const page = await fetchRelatedApprovals({ businessType: props.businessType, businessId: props.businessId, cursor });
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

class ReminderStateChangedError extends Error {}

async function sendReminderWithCapability(instanceId: string, requestId: string, reminderToken: string) {
  const capability = await fetchApprovalProgress(instanceId);
  const operationAllowed = capability.canRemind;
  if (!operationAllowed) throw new ReminderStateChangedError("审批状态已变化，请刷新进度");
  // Keep the recipient version confirmed on screen; the POST rejects any intervening change.
  return remindApprovalBySms(instanceId, requestId, reminderToken);
}

async function remind(flow: ApprovalProgress) {
  if (sending.value || !flow.canRemind) return;
  const own = generation;
  sending.value = true;
  error.value = "";
  // Retain the key on network failure, so retrying an uncertain response cannot send again.
  const request = requests.get(flow.id) ?? { requestId: crypto.randomUUID(), reminderToken: flow.reminderToken };
  requests.set(flow.id, request);
  try {
    const result = await sendReminderWithCapability(flow.id, request.requestId, request.reminderToken);
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

watch(() => [props.instanceId, props.businessType, props.businessId, props.refreshKey], () => { void load(); }, { immediate: true });
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
          <small v-if="node.legacyRoster">此历史节点未保存人员名单，以上为当前岗位人员；实际处理人以处理记录为准。</small>
        </li>
      </ol>
      <t-popconfirm
        :content="`向${names(flow.pendingRecipients)}发送审批催办短信？`"
        confirm-btn="发送短信"
        @confirm="remind(flow)"
      >
        <t-button
          theme="primary"
          :disabled="!flow.canRemind || sending"
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
.approval-progress details { margin-top: var(--jg-space-md); }
.approval-progress ul { padding-left: var(--jg-space-lg); }
</style>
