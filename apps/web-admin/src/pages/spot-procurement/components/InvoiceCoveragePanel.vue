<script setup lang="ts">
import type { SpotProcurementInvoiceCoverageReadModel,SpotProcurementInvoiceLedgerReadModel } from "../../../api/spot-procurement.api";
import { centsTextToYuanText } from "../../../lib/money";
defineProps<{coverage:SpotProcurementInvoiceCoverageReadModel;ledger:SpotProcurementInvoiceLedgerReadModel}>();
const money=(v:string)=>`¥${centsTextToYuanText(v)}`;
</script>
<template>
  <section class="coverage">
    <t-alert
      :theme="coverage.status==='fully_covered'?'success':'warning'"
      title="票据覆盖"
      :message="coverage.label"
    /><dl><div><dt>发票覆盖</dt><dd>{{ money(coverage.normalInvoiceCents) }}</dd></div><div><dt>已确认无票</dt><dd>{{ money(coverage.confirmedNoInvoiceCents) }}</dd></div><div><dt>已确认票据异常</dt><dd>{{ money(coverage.confirmedExceptionCents) }}</dd></div><div><dt>待复核事项</dt><dd>{{ coverage.pendingCount }}</dd></div></dl><t-tabs>
      <t-tab-panel
        value="invoice"
        :label="`发票 ${ledger.invoices.length}`"
      /><t-tab-panel
        value="no-invoice"
        :label="`无票 ${ledger.noInvoiceConfirmations.length}`"
      /><t-tab-panel
        value="exception"
        :label="`票据异常 ${ledger.invoiceExceptions.length}`"
      />
    </t-tabs>
  </section>
</template>
<style scoped>.coverage{display:grid;gap:var(--jg-space-md)}dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--jg-space-sm);margin:0}dl div{padding:var(--jg-space-sm);background:var(--jg-color-bg-secondary)}dd{margin:4px 0 0;font-weight:600}@media(max-width:720px){dl{grid-template-columns:1fr 1fr}}</style>
