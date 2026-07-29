<template>
  <t-card
    data-testid="contract-takeover-dual-confirmation"
    :bordered="true"
  >
    <template #header>
      <div class="card-head">
        <div>
          <strong>双部门确认</strong>
          <span>两侧主管基于同一财务口径确认后，系统才会在同一事务激活。</span>
        </div>
        <t-tag :theme="activated ? 'success' : 'warning'">
          {{ activated ? "已激活" : "等待双侧确认" }}
        </t-tag>
      </div>
    </template>
    <div class="confirmation-grid">
      <section>
        <strong>合同侧 v{{ contractRevision }}</strong>
        <span>确认修订：{{ contractConfirmedRevision ?? "未确认" }}</span>
        <span>确认人：{{ contractConfirmedBy || "—" }}</span>
        <span>确认时间：{{ contractConfirmedAt || "—" }}</span>
        <div class="actions">
          <t-button
            v-if="canConfirmContract && contractConfirmedRevision !== contractRevision"
            size="small"
            theme="primary"
            @click="$emit('confirm', 'contract')"
          >
            确认合同侧
          </t-button>
          <t-button
            v-if="canConfirmContract && contractConfirmedRevision === contractRevision && !activated"
            size="small"
            variant="outline"
            @click="$emit('withdraw', 'contract')"
          >
            撤回合同侧确认
          </t-button>
        </div>
      </section>
      <section>
        <strong>财务侧 v{{ financeRevision }}</strong>
        <span>确认修订：{{ financeConfirmedRevision ?? "未确认" }}</span>
        <span>{{ financeBasisLabel }}</span>
        <span>确认人：{{ financeConfirmedBy || "—" }}</span>
        <span>确认时间：{{ financeConfirmedAt || "—" }}</span>
        <div class="actions">
          <t-button
            v-if="canConfirmFinance && financeConfirmedRevision !== financeRevision"
            size="small"
            theme="primary"
            :disabled="financeBasisStale"
            @click="$emit('confirm', 'finance')"
          >
            确认财务侧
          </t-button>
          <t-button
            v-if="canConfirmFinance && financeConfirmedRevision === financeRevision && !activated"
            size="small"
            variant="outline"
            @click="$emit('withdraw', 'finance')"
          >
            撤回财务侧确认
          </t-button>
        </div>
      </section>
    </div>
  </t-card>
</template>

<script setup lang="ts">
defineProps<{
  activated: boolean;
  contractRevision: number;
  contractConfirmedRevision: number | null;
  contractConfirmedBy: string | null;
  contractConfirmedAt: string | null;
  financeRevision: number;
  financeConfirmedRevision: number | null;
  financeConfirmedBy: string | null;
  financeConfirmedAt: string | null;
  financeBasisLabel: string;
  financeBasisStale: boolean;
  canConfirmContract: boolean;
  canConfirmFinance: boolean;
}>();

defineEmits<{
  confirm: [side: "contract" | "finance"];
  withdraw: [side: "contract" | "finance"];
}>();
</script>

<style scoped>
.card-head,
.confirmation-grid section,
.card-head > div {
  display: grid;
  gap: var(--jg-space-2);
}

.card-head {
  grid-template-columns: minmax(0, 1fr) auto;
}

.card-head span,
.confirmation-grid section > span {
  color: var(--jg-text-secondary);
  font-size: var(--jg-font-size-sm);
}

.confirmation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--jg-space-3);
}

.confirmation-grid section {
  padding: var(--jg-space-3);
  border: 1px solid var(--jg-border-color);
  border-radius: var(--jg-radius-md);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--jg-space-2);
}

@media (max-width: 720px) {
  .card-head,
  .confirmation-grid {
    grid-template-columns: 1fr;
  }
}
</style>
