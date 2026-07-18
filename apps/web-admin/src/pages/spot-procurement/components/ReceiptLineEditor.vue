<script setup lang="ts">
import type { SpotProcurementReceiptLineReadModel } from "../../../api/spot-procurement.api";

defineProps<{ lines: SpotProcurementReceiptLineReadModel[]; readonly?: boolean }>();
const emit = defineEmits<{ change: [lines: SpotProcurementReceiptLineReadModel[]] }>();

function update(lines: SpotProcurementReceiptLineReadModel[], index: number, key: keyof SpotProcurementReceiptLineReadModel, value: unknown) {
  const next = lines.map((line, lineIndex) =>
    lineIndex === index ? { ...line, [key]: value } : line
  );
  emit("change", next);
}
</script>

<template>
  <div class="receipt-lines">
    <article
      v-for="(line, index) in lines"
      :key="line.procurementLineId"
      class="receipt-line"
    >
      <header>
        <strong>{{ line.sortOrder }}. {{ line.materialName }}</strong>
        <span>{{ line.specification || "无规格" }} · 采购申请数量 {{ line.approvedQuantity }} {{ line.unit }}</span>
      </header>
      <div class="line-fields">
        <label><span>实际到货数量</span><t-input
          :value="line.qualifiedQuantity ?? '0'"
          :disabled="readonly"
          @change="update(lines, index, 'qualifiedQuantity', String($event))"
        /></label>
        <label><span>不合格/破损数量</span><t-input
          :value="line.unqualifiedQuantity ?? '0'"
          :disabled="readonly"
          @change="update(lines, index, 'unqualifiedQuantity', String($event))"
        /></label>
        <label><span>无偿附赠</span><t-input
          :value="line.freeGiftQuantity ?? '0'"
          :disabled="readonly"
          @change="update(lines, index, 'freeGiftQuantity', String($event))"
        /></label>
        <label class="wide"><span>不合格原因</span><t-input
          :value="line.unqualifiedReason ?? ''"
          :disabled="readonly"
          @change="update(lines, index, 'unqualifiedReason', String($event))"
        /></label>
        <label class="wide"><span>到货/少货说明</span><t-input
          :value="line.discrepancyNote ?? ''"
          :disabled="readonly"
          @change="update(lines, index, 'discrepancyNote', String($event))"
        /></label>
      </div>
    </article>
  </div>
</template>

<style scoped>
.receipt-lines,.receipt-line{display:grid;gap:var(--jg-space-md)}
.receipt-line{padding:var(--jg-space-md);border:1px solid var(--jg-color-border);border-radius:var(--jg-radius-md)}
header{display:flex;justify-content:space-between;gap:var(--jg-space-md);color:var(--jg-color-text-secondary)}
.line-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--jg-space-sm)}
label{display:grid;gap:var(--jg-space-xs)} .wide{grid-column:span 2}
@media(max-width:800px){.line-fields{grid-template-columns:1fr 1fr}.wide{grid-column:span 2}header{display:grid}}
</style>
