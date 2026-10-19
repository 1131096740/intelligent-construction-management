-- Capture only file identity and content fingerprints; never storage keys or credentials.
CREATE FUNCTION public.jg_draft_deletion_file_audit(p_ids TEXT[])
RETURNS JSONB LANGUAGE SQL STABLE SET search_path=public,pg_temp AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',"originalName",'contentSha256',"contentSha256",'sizeBytes',"sizeBytes") ORDER BY id),'[]'::jsonb)
 FROM public."FileObject" WHERE id=ANY(p_ids);
$$;
REVOKE ALL ON FUNCTION public.jg_draft_deletion_file_audit(TEXT[]) FROM PUBLIC;

-- Narrow entry points: runtime keeps no direct DELETE privilege on protected tables.
CREATE FUNCTION public.jg_delete_unsubmitted_expense_claim(p_id TEXT, p_actor TEXT, p_updated TIMESTAMP)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE item public."ExpenseClaim"%ROWTYPE; deletion_metadata JSONB;
BEGIN
  SELECT * INTO item FROM public."ExpenseClaim" WHERE "id" = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF item."handledByUserId" <> p_actor OR NOT EXISTS (SELECT 1 FROM public."User" WHERE "id" = p_actor AND "isActive")
    OR p_updated IS NULL OR item."updatedAt" <> p_updated OR item."status" <> 'draft' OR item."submittedAt" IS NOT NULL
    OR item."approvalInstanceId" IS NOT NULL OR item."approvedAt" IS NOT NULL OR item."voidedAt" IS NOT NULL
    OR item."fundedAmountCents" <> 0 OR item."loanOffsetAmountCents" <> 0
    OR EXISTS (SELECT 1 FROM public."ApprovalInstance" WHERE "businessType" = 'expense_claim' AND "businessId" = p_id)
    OR EXISTS (SELECT 1 FROM public."ExpenseClaimEntrySnapshot" WHERE "expenseClaimId" = p_id)
    OR EXISTS (SELECT 1 FROM public."ExpenseClaimAttachment" WHERE "expenseClaimId" = p_id AND ("stage" <> 'draft' OR "frozenAt" IS NOT NULL))
    OR EXISTS (SELECT 1 FROM public."ExpenseClaimPaymentExecution" WHERE "expenseClaimId" = p_id)
    OR EXISTS (SELECT 1 FROM public."ExpenseLoanOffsetReservation" WHERE "expenseClaimId" = p_id)
    OR EXISTS (SELECT 1 FROM public."EmployeeProjectLoanEntry" WHERE "sourceExpenseClaimId" = p_id)
  THEN RETURN FALSE; END IF;
  deletion_metadata := jsonb_build_object('code',item.code,'requestKey',item."generalProcurementRequestKey",'generalProcurementId',item."generalProcurementId",
    'projectId',item."projectId",'companyEntityId',item."companyEntityId",'claimType',item."claimType",'previousStatus',item.status,
    'applicantUserId',item."applicantUserId",'handledByUserId',item."handledByUserId",'requestedAmountCents',item."requestedAmountCents"::text,'updatedAt',item."updatedAt",
    'deletedReferences',jsonb_build_object('lineIds',ARRAY(SELECT id FROM public."ExpenseClaimLine" WHERE "expenseClaimId"=p_id ORDER BY id),'attachmentIds',ARRAY(SELECT id FROM public."ExpenseClaimAttachment" WHERE "expenseClaimId"=p_id ORDER BY id)),
    'files',public.jg_draft_deletion_file_audit(ARRAY(SELECT "fileId" FROM public."ExpenseClaimAttachment" WHERE "expenseClaimId"=p_id)));
  DELETE FROM public."ExpenseClaimAttachment" WHERE "expenseClaimId" = p_id;
  DELETE FROM public."ExpenseClaimLine" WHERE "expenseClaimId" = p_id;
  DELETE FROM public."ExpenseClaim" WHERE "id" = p_id;
  INSERT INTO public."AuditLog" ("id", "actorUserId", "action", "businessType", "businessId", "metadata")
    VALUES (gen_random_uuid()::TEXT, p_actor, 'expense_claim.draft.delete', 'expense_claim', p_id,
      deletion_metadata);
  RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_expense_claim(TEXT,TEXT,TIMESTAMP) FROM PUBLIC;

CREATE FUNCTION public.jg_delete_unsubmitted_general_procurement(p_id TEXT, p_actor TEXT, p_revision INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE item public."GeneralProcurement"%ROWTYPE;
BEGIN
  SELECT * INTO item FROM public."GeneralProcurement" WHERE "id" = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF item."applicantUserId" <> p_actor OR NOT EXISTS (SELECT 1 FROM public."User" WHERE "id" = p_actor AND "isActive")
    OR p_revision IS NULL OR item."revision" <> p_revision OR item."status" <> 'draft' OR item."approvalInstanceId" IS NOT NULL
    OR item."submissions" <> '[]'::jsonb OR item."archivedAt" IS NOT NULL OR item."archiveFileId" IS NOT NULL
    OR EXISTS (SELECT 1 FROM public."ApprovalInstance" WHERE "businessType" = 'general_procurement' AND "businessId" = p_id)
    OR EXISTS (SELECT 1 FROM public."ExpenseClaim" WHERE "generalProcurementId" = p_id)
  THEN RETURN FALSE; END IF;
  DELETE FROM public."GeneralProcurement" WHERE "id" = p_id;
  INSERT INTO public."AuditLog" ("id", "actorUserId", "action", "businessType", "businessId", "metadata")
    VALUES (gen_random_uuid()::TEXT, p_actor, 'general_procurement.draft.delete', 'general_procurement', p_id,
      jsonb_build_object('code',item.code,'requestKey',item."requestKey",'revision',item.revision,'projectId',item."projectId",'companyEntityId',item."companyEntityId",'applicantUserId',item."applicantUserId",'previousStatus',item.status,'category',item.category,'requestedAmountCents',item."requestedAmountCents"::text));
  RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_general_procurement(TEXT,TEXT,INTEGER) FROM PUBLIC;

CREATE FUNCTION public.jg_delete_unsubmitted_settlement(p_id TEXT, p_actor TEXT, p_revision INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE item public."SettlementDraft"%ROWTYPE;
BEGIN
  SELECT * INTO item FROM public."SettlementDraft" WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF item."ownerUserId" <> p_actor OR p_revision IS NULL OR item.revision <> p_revision OR item.status <> 'draft'
    OR item."submittedAt" IS NOT NULL OR item."submittedSettlementId" IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM public."User" WHERE id=p_actor AND "isActive")
    OR EXISTS (SELECT 1 FROM public."ApprovalInstance" WHERE "businessType"='settlement_draft' AND "businessId"=p_id)
    OR EXISTS (SELECT 1 FROM public."ContractSettlementProcess" WHERE (id=item."processId" OR "settlementDraftId"=p_id) AND ("settlementId" IS NOT NULL OR status <> 'open'))
    OR EXISTS (SELECT 1 FROM public."Settlement" WHERE "processId" IN (SELECT id FROM public."ContractSettlementProcess" WHERE id=item."processId" OR "settlementDraftId"=p_id))
    OR EXISTS (SELECT 1 FROM public."SettlementSignedDocument" WHERE "settlementDraftId"=p_id AND "settlementId" IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public."SettlementLineAttachment" WHERE "settlementDraftLineId" IN (SELECT id FROM public."SettlementDraftLine" WHERE "settlementDraftId"=p_id) AND "settlementLineId" IS NOT NULL)
  THEN RETURN FALSE; END IF;
  INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata)
  VALUES (gen_random_uuid()::text,p_actor,'settlement.draft.delete','settlement_draft',p_id,
    jsonb_build_object('code',item.code,'projectId',item."projectId",'contractId',item."contractId",'revision',item.revision,
      'previousStatus',item.status,'isFinal',item."isFinal",'finalCumulativeAmountCents',item."finalCumulativeAmountCents"::text,
      'deletedReferences',jsonb_build_object('lineIds',ARRAY(SELECT id FROM public."SettlementDraftLine" WHERE "settlementDraftId"=p_id ORDER BY id),
        'documentIds',ARRAY(SELECT id FROM public."SettlementSignedDocument" WHERE "settlementDraftId"=p_id ORDER BY id),
        'attachmentIds',ARRAY(SELECT id FROM public."SettlementLineAttachment" WHERE "settlementDraftLineId" IN(SELECT id FROM public."SettlementDraftLine" WHERE "settlementDraftId"=p_id) ORDER BY id),
        'processIds',ARRAY(SELECT id FROM public."ContractSettlementProcess" WHERE id=item."processId" OR "settlementDraftId"=p_id ORDER BY id)),
      'files',public.jg_draft_deletion_file_audit(ARRAY(SELECT "fileId" FROM public."SettlementSignedDocument" WHERE "settlementDraftId"=p_id UNION SELECT "fileId" FROM public."SettlementLineAttachment" WHERE "settlementDraftLineId" IN(SELECT id FROM public."SettlementDraftLine" WHERE "settlementDraftId"=p_id)))));
  DELETE FROM public."SettlementSignedDocumentGenerationClaim" WHERE "originalDocumentId" IN (SELECT id FROM public."SettlementSignedDocument" WHERE "settlementDraftId"=p_id) OR "finalDocumentId" IN (SELECT id FROM public."SettlementSignedDocument" WHERE "settlementDraftId"=p_id);
  DELETE FROM public."SettlementSignedDocument" WHERE "settlementDraftId"=p_id;
  DELETE FROM public."SettlementLineAttachment" WHERE "settlementDraftLineId" IN (SELECT id FROM public."SettlementDraftLine" WHERE "settlementDraftId"=p_id);
  DELETE FROM public."SettlementDraftLine" WHERE "settlementDraftId"=p_id;
  DELETE FROM public."SettlementImport" WHERE "settlementDraftId"=p_id;
  UPDATE public."SettlementDraft" SET "processId"=NULL WHERE id=p_id;
  DELETE FROM public."ContractSettlementProcess" WHERE id=item."processId" OR "settlementDraftId"=p_id;
  DELETE FROM public."SettlementDraft" WHERE id=p_id;
  RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_settlement(TEXT,TEXT,INTEGER) FROM PUBLIC;

CREATE FUNCTION public.jg_delete_unsubmitted_takeover(p_id TEXT,p_actor TEXT,p_updated TIMESTAMP)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public."ContractTakeover"%ROWTYPE; contract_code TEXT;
BEGIN
 SELECT * INTO item FROM public."ContractTakeover" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 PERFORM 1 FROM public."Contract" WHERE id=item."contractId" FOR UPDATE;
 PERFORM 1 FROM public."ContractVersion" WHERE id=item."contractVersionId" FOR UPDATE;
 IF (item."createdByUserId" <> p_actor AND item."responsibleUserId" IS DISTINCT FROM p_actor)
   OR NOT EXISTS (SELECT 1 FROM public."User" WHERE id=p_actor AND "isActive")
   OR p_updated IS NULL OR item."updatedAt" <> p_updated OR item."takeoverStatus" <> 'draft'
   OR item."submittedAt" IS NOT NULL OR item."confirmedAt" IS NOT NULL OR item."activatedAt" IS NOT NULL
   OR item."historicalBalanceConfirmedAt" IS NOT NULL OR item."historicalInitialSettlementId" IS NOT NULL
   OR EXISTS (SELECT 1 FROM public."ContractTakeoverConfirmationEvent" WHERE "takeoverId"=p_id)
   OR EXISTS (SELECT 1 FROM public."ContractTakeoverCorrection" WHERE "takeoverId"=p_id)
   OR EXISTS (SELECT 1 FROM public."ContractTakeoverBalanceAccount" WHERE "takeoverId"=p_id)
   OR EXISTS (SELECT 1 FROM public."ContractTakeoverHistoricalPayment" WHERE "takeoverId"=p_id AND (status<>'draft' OR "activatedAt" IS NOT NULL))
   OR EXISTS (SELECT 1 FROM public."ApprovalInstance" WHERE "businessId" IN (p_id,item."contractVersionId"))
   OR EXISTS (SELECT 1 FROM public."ContractTaxFactRevision" WHERE "contractVersionId"=item."contractVersionId" AND (status<>'draft' OR "submittedAt" IS NOT NULL OR "confirmedAt" IS NOT NULL))
   OR EXISTS (SELECT 1 FROM public."Settlement" WHERE "contractId"=item."contractId")
   OR EXISTS (SELECT 1 FROM public."PaymentRequest" WHERE "contractId"=item."contractId")
   OR EXISTS (SELECT 1 FROM public."ContractVersion" WHERE "contractId"=item."contractId" AND (id<>item."contractVersionId" OR status<>'draft' OR "effectiveAt" IS NOT NULL))
   OR NOT EXISTS (SELECT 1 FROM public."Contract" WHERE id=item."contractId" AND source='historical_takeover')
   OR NOT EXISTS (SELECT 1 FROM public."PaymentTermsVersion" WHERE id=item."paymentTermsVersionId" AND status='draft')
 THEN RETURN FALSE; END IF;
 SELECT code INTO contract_code FROM public."Contract" WHERE id=item."contractId";
 INSERT INTO public."AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata)
 VALUES(gen_random_uuid()::text,p_actor,'contract_takeover.draft.delete','contract_takeover',p_id,
 jsonb_build_object('projectId',item."projectId",'contractId',item."contractId",'contractVersionId',item."contractVersionId",'code',contract_code,
 'takeoverBatchId',item."takeoverBatchId",'importRowNo',item."importRowNo",'previousStatus',item."takeoverStatus",'updatedAt',item."updatedAt",
 'deletedReferences',jsonb_build_object('historicalPaymentIds',ARRAY(SELECT id FROM public."ContractTakeoverHistoricalPayment" WHERE "takeoverId"=p_id ORDER BY id),
   'taxRevisionIds',ARRAY(SELECT id FROM public."ContractTaxFactRevision" WHERE "contractVersionId"=item."contractVersionId" ORDER BY id),
   'billIds',ARRAY(SELECT id FROM public."ContractBill" WHERE "contractVersionId"=item."contractVersionId" ORDER BY id)),
 'files',public.jg_draft_deletion_file_audit(ARRAY(
   SELECT "fileId" FROM public."ArchiveRecord" WHERE "businessType"='contract_takeover' AND "businessId"=p_id
   UNION SELECT "fileId" FROM public."ContractTakeoverSettlementEvidence" WHERE "takeoverId"=p_id
   UNION SELECT "fileId" FROM public."ContractTakeoverExcessEvidence" WHERE "takeoverId"=p_id
   UNION SELECT "fileId" FROM public."ContractTakeoverHistoricalPaymentVoucher" WHERE "historicalPaymentId" IN(SELECT id FROM public."ContractTakeoverHistoricalPayment" WHERE "takeoverId"=p_id)
   UNION SELECT "evidenceFileId" FROM public."ContractTaxFactRevision" WHERE "contractVersionId"=item."contractVersionId"))));
 DELETE FROM public."ArchiveRecord" WHERE "businessType"='contract_takeover' AND "businessId"=p_id;
 DELETE FROM public."ContractTakeoverSideSaveRequest" WHERE "takeoverId"=p_id;
 DELETE FROM public."ContractTakeoverSettlementEvidence" WHERE "takeoverId"=p_id;
 DELETE FROM public."ContractTakeoverExcessEvidence" WHERE "takeoverId"=p_id;
 DELETE FROM public."ContractTakeoverHistoricalPaymentVoucher" WHERE "historicalPaymentId" IN (SELECT id FROM public."ContractTakeoverHistoricalPayment" WHERE "takeoverId"=p_id);
 DELETE FROM public."ContractTakeoverHistoricalPaymentAllocation" WHERE "historicalPaymentId" IN (SELECT id FROM public."ContractTakeoverHistoricalPayment" WHERE "takeoverId"=p_id);
 DELETE FROM public."ContractTakeoverHistoricalPayment" WHERE "takeoverId"=p_id;
 DELETE FROM public."ContractTakeoverContractFacts" WHERE "takeoverId"=p_id;
 DELETE FROM public."ContractTakeoverFinanceFacts" WHERE "takeoverId"=p_id;
 DELETE FROM public."ContractTakeover" WHERE id=p_id;
 DELETE FROM public."ContractBillRow" WHERE "contractBillId" IN (SELECT id FROM public."ContractBill" WHERE "contractVersionId"=item."contractVersionId");
 DELETE FROM public."ContractBill" WHERE "contractVersionId"=item."contractVersionId";
 DELETE FROM public."ContractTaxFactRevision" WHERE "contractVersionId"=item."contractVersionId";
 DELETE FROM public."PaymentTermsStage" WHERE "paymentTermsVersionId"=item."paymentTermsVersionId";
 DELETE FROM public."PaymentTermsVersion" WHERE id=item."paymentTermsVersionId";
 DELETE FROM public."ContractVersion" WHERE id=item."contractVersionId";
 DELETE FROM public."Contract" WHERE id=item."contractId";
 IF contract_code IS NOT NULL THEN
   INSERT INTO public."ContractNumberTombstone"(id,"formalCode") VALUES(gen_random_uuid()::text,contract_code) ON CONFLICT("formalCode") DO NOTHING;
 END IF;
 RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_takeover(TEXT,TEXT,TIMESTAMP) FROM PUBLIC;

-- Stable audit identities preserve immutable reserve/release ledger references after draft deletion.
-- No ledger entry, amount, sequence, reservation or account balance is rewritten.
CREATE TABLE public."SpotProcurementAuditSource" (id TEXT PRIMARY KEY, code TEXT NOT NULL, "projectId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE public."SpotPaymentAuditSource" (id TEXT PRIMARY KEY, code TEXT NOT NULL, "projectId" TEXT NOT NULL, "procurementId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO public."SpotProcurementAuditSource"(id,code,"projectId") SELECT id,code,"projectId" FROM public."SpotProcurement";
INSERT INTO public."SpotPaymentAuditSource"(id,code,"projectId","procurementId") SELECT id,code,"projectId","procurementId" FROM public."SpotProcurementPayment";
CREATE FUNCTION public.jg_spot_audit_source_insert() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='SpotProcurement' THEN
   INSERT INTO public."SpotProcurementAuditSource"(id,code,"projectId") VALUES(NEW.id,NEW.code,NEW."projectId");
 ELSE
   INSERT INTO public."SpotPaymentAuditSource"(id,code,"projectId","procurementId") VALUES(NEW.id,NEW.code,NEW."projectId",NEW."procurementId");
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jg_spot_audit_source_insert() FROM PUBLIC;
CREATE TRIGGER jg_spot_audit_source_insert AFTER INSERT ON public."SpotProcurement" FOR EACH ROW EXECUTE FUNCTION public.jg_spot_audit_source_insert();
CREATE TRIGGER jg_spot_payment_audit_source_insert AFTER INSERT ON public."SpotProcurementPayment" FOR EACH ROW EXECUTE FUNCTION public.jg_spot_audit_source_insert();
CREATE FUNCTION public.jg_spot_audit_source_immutable() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '采购来源审计记录不可改写或删除' USING ERRCODE='23514'; END $$;
CREATE TRIGGER jg_spot_audit_source_immutable BEFORE UPDATE OR DELETE ON public."SpotProcurementAuditSource" FOR EACH ROW EXECUTE FUNCTION public.jg_spot_audit_source_immutable();
CREATE TRIGGER jg_spot_payment_audit_source_immutable BEFORE UPDATE OR DELETE ON public."SpotPaymentAuditSource" FOR EACH ROW EXECUTE FUNCTION public.jg_spot_audit_source_immutable();
ALTER TABLE public."SupplierBalanceReservation" DROP CONSTRAINT "SupplierBalanceReservation_paymentId_fkey", ADD CONSTRAINT "SupplierBalanceReservation_paymentId_fkey" FOREIGN KEY("paymentId") REFERENCES public."SpotPaymentAuditSource"(id);
ALTER TABLE public."SupplierBalanceEntry" DROP CONSTRAINT "SupplierBalanceEntry_paymentId_fkey", ADD CONSTRAINT "SupplierBalanceEntry_paymentId_fkey" FOREIGN KEY("paymentId") REFERENCES public."SpotPaymentAuditSource"(id);
ALTER TABLE public."SupplierBalanceEntry" DROP CONSTRAINT "SupplierBalanceEntry_procurementId_fkey", ADD CONSTRAINT "SupplierBalanceEntry_procurementId_fkey" FOREIGN KEY("procurementId") REFERENCES public."SpotProcurementAuditSource"(id);
-- New references must still point to live business records. FOR KEY SHARE serializes with deletion.
CREATE FUNCTION public.jg_supplier_balance_live_source() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW."paymentId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId") THEN
   PERFORM 1 FROM public."SpotProcurementPayment" WHERE id=NEW."paymentId" FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION '付款草稿已删除，不能新增余额记录' USING ERRCODE='23503'; END IF;
 END IF;
 IF TG_TABLE_NAME='SupplierBalanceEntry' THEN
   IF NEW."procurementId" IS NOT NULL AND (TG_OP='INSERT' OR NEW."procurementId" IS DISTINCT FROM OLD."procurementId") THEN
     PERFORM 1 FROM public."SpotProcurement" WHERE id=NEW."procurementId" FOR KEY SHARE;
     IF NOT FOUND THEN RAISE EXCEPTION '采购草稿已删除，不能新增余额记录' USING ERRCODE='23503'; END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jg_supplier_balance_live_source() FROM PUBLIC;
CREATE TRIGGER jg_supplier_balance_live_source BEFORE INSERT OR UPDATE ON public."SupplierBalanceReservation" FOR EACH ROW EXECUTE FUNCTION public.jg_supplier_balance_live_source();
CREATE TRIGGER jg_supplier_balance_live_source BEFORE INSERT OR UPDATE ON public."SupplierBalanceEntry" FOR EACH ROW EXECUTE FUNCTION public.jg_supplier_balance_live_source();

CREATE FUNCTION public.jg_delete_unsubmitted_spot_payment(p_id TEXT,p_actor TEXT,p_updated TIMESTAMP,p_reason TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public."SpotProcurementPayment"%ROWTYPE;
BEGIN
 SELECT * INTO item FROM public."SpotProcurementPayment" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF item."handlerUserId"<>p_actor OR NOT EXISTS(SELECT 1 FROM public."User" WHERE id=p_actor AND "isActive")
   OR p_updated IS NULL OR item."updatedAt"<>p_updated OR item.status<>'draft' OR item."submittedAt" IS NOT NULL OR item."approvedAt" IS NOT NULL OR item."factsFrozenAt" IS NOT NULL
   OR NULLIF(BTRIM(p_reason),'') IS NULL OR item."paidAmountCents"<>0 OR item."executedSupplierBalanceAmountCents"<>0
   OR EXISTS(SELECT 1 FROM public."ApprovalInstance" WHERE "businessType"='spot_procurement_payment' AND "businessId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementPaymentExecution" WHERE "paymentId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SupplierBalanceReservation" WHERE "paymentId"=p_id AND (status<>'released' OR "releasedAmountCents"<>"amountCents" OR "executedAt" IS NOT NULL))
   OR EXISTS(SELECT 1 FROM public."SupplierBalanceEntry" WHERE "paymentId"=p_id AND "entryType" NOT IN ('reserve','release','partial_release'))
   OR EXISTS(SELECT 1 FROM public."SpotProcurementPaymentInvoice" WHERE "paymentId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementPaymentArchive" WHERE "paymentId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementRefund" WHERE "paymentId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementPayment" WHERE "sourcePaymentId"=p_id)
 THEN RETURN FALSE; END IF;
 INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId",metadata)
 VALUES(gen_random_uuid()::text,p_actor,'spot_procurement.payment.draft.delete','spot_procurement_payment',p_id,
 jsonb_build_object('code',item.code,'projectId',item."projectId",'procurementId',item."procurementId",'procurementVersionId',item."procurementVersionId",'reason',p_reason,
 'previousStatus',item.status,'updatedAt',item."updatedAt",'settlementAmountCents',item."settlementAmountCents"::text,'supplierBalanceAmountCents',item."supplierBalanceAmountCents"::text,'companyPaymentAmountCents',item."companyPaymentAmountCents"::text,
 'deletedReferences',jsonb_build_object('lineIds',ARRAY(SELECT id FROM public."SpotProcurementPaymentLine" WHERE "paymentId"=p_id ORDER BY id),'attachmentIds',ARRAY(SELECT id FROM public."SpotProcurementPaymentAttachment" WHERE "paymentId"=p_id ORDER BY id),'channelIds',ARRAY(SELECT id FROM public."SpotProcurementPaymentChannel" WHERE "paymentId"=p_id ORDER BY id)),
 'retainedReservationIds',ARRAY(SELECT id FROM public."SupplierBalanceReservation" WHERE "paymentId"=p_id ORDER BY id),
 'files',public.jg_draft_deletion_file_audit(ARRAY(SELECT "fileId" FROM public."SpotProcurementPaymentAttachment" WHERE "paymentId"=p_id UNION SELECT item."supportingAttachmentFileId" UNION SELECT item."merchantPaymentProofFileId"))));
 UPDATE public."SpotProcurementPayment" SET "primaryPaymentChannelId"=NULL WHERE id=p_id;
 DELETE FROM public."SpotProcurementPaymentAttachment" WHERE "paymentId"=p_id;
 DELETE FROM public."SpotProcurementPaymentMethodOption" WHERE "paymentId"=p_id;
 DELETE FROM public."SpotProcurementPaymentLine" WHERE "paymentId"=p_id;
 DELETE FROM public."SpotProcurementPaymentChannel" WHERE "paymentId"=p_id;
 DELETE FROM public."SpotProcurementPayment" WHERE id=p_id;
 RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_spot_payment(TEXT,TEXT,TIMESTAMP,TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_delete_unsubmitted_spot_procurement(p_id TEXT,p_actor TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public."SpotProcurement"%ROWTYPE; payment RECORD;
BEGIN
 SELECT * INTO item FROM public."SpotProcurement" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF item."handlerUserId"<>p_actor OR item.status<>'draft' OR NOT EXISTS(SELECT 1 FROM public."User" WHERE id=p_actor AND "isActive")
   OR EXISTS(SELECT 1 FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id AND ("submittedAt" IS NOT NULL OR "approvedAt" IS NOT NULL OR status<>'draft'))
   OR EXISTS(SELECT 1 FROM public."ApprovalInstance" WHERE "businessType"='spot_procurement_version' AND "businessId" IN(SELECT id FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id))
   OR EXISTS(SELECT 1 FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id AND ("firstSubmittedAt" IS NOT NULL OR "submittedAt" IS NOT NULL OR status<>'draft'))
   OR EXISTS(SELECT 1 FROM public."SpotProcurementReceiptRevision" WHERE "procurementId"=p_id AND "submittedAt" IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementReceiptReview" WHERE "procurementId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementDiscrepancy" WHERE "procurementId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SpotProcurementRefund" WHERE "procurementId"=p_id)
   OR EXISTS(SELECT 1 FROM public."SupplierBalanceEntry" WHERE "procurementId"=p_id AND "entryType" NOT IN('reserve','release','partial_release'))
 THEN RETURN FALSE; END IF;
 FOR payment IN SELECT * FROM public."SpotProcurementPayment" WHERE "procurementId"=p_id ORDER BY id FOR UPDATE LOOP
   IF NOT public.jg_delete_unsubmitted_spot_payment(payment.id,p_actor,payment."updatedAt",'删除从未提交的采购草稿') THEN
     RAISE EXCEPTION '关联付款已有正式事实，不能删除采购草稿' USING ERRCODE='23514';
   END IF;
 END LOOP;
 INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId",metadata)
 VALUES(gen_random_uuid()::text,p_actor,'spot_procurement.draft.delete','spot_procurement',p_id,jsonb_build_object('code',item.code,'projectId',item."projectId",'previousStatus',item.status,'handlerUserId',item."handlerUserId",
 'deletedReferences',jsonb_build_object('versionIds',ARRAY(SELECT id FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id ORDER BY id),
   'lineIds',ARRAY(SELECT id FROM public."SpotProcurementLine" WHERE "versionId" IN(SELECT id FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id) ORDER BY id),
   'receiptIds',ARRAY(SELECT id FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id ORDER BY id)),
 'files',public.jg_draft_deletion_file_audit(ARRAY(SELECT "fileId" FROM public."SpotProcurementAttachment" WHERE "versionId" IN(SELECT id FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id)
   UNION SELECT "originalFileId" FROM public."SpotProcurementReceiptPhoto" WHERE "receiptId" IN(SELECT id FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id) UNION SELECT "watermarkedFileId" FROM public."SpotProcurementReceiptPhoto" WHERE "receiptId" IN(SELECT id FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id)))));
 DELETE FROM public."SpotProcurementReceiptPhoto" WHERE "receiptId" IN(SELECT id FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id);
 DELETE FROM public."SpotProcurementReceiptLine" WHERE "procurementId"=p_id;
 DELETE FROM public."SpotProcurementReceiptRevision" WHERE "procurementId"=p_id;
 DELETE FROM public."SpotProcurementReceiptDelegation" WHERE "receiptId" IN(SELECT id FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id);
 DELETE FROM public."SpotProcurementReceipt" WHERE "procurementId"=p_id;
 DELETE FROM public."SpotProcurementAttachment" WHERE "versionId" IN(SELECT id FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id);
 DELETE FROM public."SpotProcurementLine" WHERE "versionId" IN(SELECT id FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id);
 UPDATE public."SpotProcurement" SET "currentVersionId"=NULL WHERE id=p_id;
 DELETE FROM public."SpotProcurementVersion" WHERE "procurementId"=p_id;
 DELETE FROM public."SpotProcurement" WHERE id=p_id;
 RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_spot_procurement(TEXT,TEXT) FROM PUBLIC;
-- Remove inherited write defaults only from these new immutable audit tables.
DO $$ DECLARE acl RECORD; BEGIN
 FOR acl IN SELECT DISTINCT grantee,table_name FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN('SpotProcurementAuditSource','SpotPaymentAuditSource') AND grantee<>current_user LOOP
   IF acl.grantee='PUBLIC' THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',acl.table_name);
   ELSE EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',acl.table_name,acl.grantee); END IF;
 END LOOP;
END $$;

-- Replacing the ledger FKs with stable audit identities must not permit a raw
-- DELETE to bypass the release/approval checks in the narrow deletion functions.
CREATE FUNCTION public.jg_spot_ledger_delete_guard() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_TABLE_NAME='SpotProcurementPayment' THEN
   IF EXISTS(SELECT 1 FROM public."SupplierBalanceReservation" WHERE "paymentId"=OLD.id)
     OR EXISTS(SELECT 1 FROM public."SupplierBalanceEntry" WHERE "paymentId"=OLD.id) THEN
     IF OLD.status<>'draft' OR OLD."submittedAt" IS NOT NULL OR OLD."approvedAt" IS NOT NULL
       OR OLD."paidAmountCents"<>0 OR OLD."executedSupplierBalanceAmountCents"<>0
       OR EXISTS(SELECT 1 FROM public."SupplierBalanceReservation" WHERE "paymentId"=OLD.id AND (status<>'released' OR "releasedAmountCents"<>"amountCents" OR "executedAt" IS NOT NULL))
       OR EXISTS(SELECT 1 FROM public."SupplierBalanceEntry" WHERE "paymentId"=OLD.id AND "entryType" NOT IN('reserve','release','partial_release'))
       OR NOT EXISTS(SELECT 1 FROM public."AuditLog" WHERE "businessId"=OLD.id AND action='spot_procurement.payment.draft.delete')
     THEN RAISE EXCEPTION '余额来源只能在草稿删除核验并释放预占后移除' USING ERRCODE='23514'; END IF;
   END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM public."SupplierBalanceEntry" WHERE "procurementId"=OLD.id) THEN
     IF OLD.status<>'draft'
       OR EXISTS(SELECT 1 FROM public."SupplierBalanceEntry" WHERE "procurementId"=OLD.id AND "entryType" NOT IN('reserve','release','partial_release'))
       OR NOT EXISTS(SELECT 1 FROM public."AuditLog" WHERE "businessId"=OLD.id AND action='spot_procurement.draft.delete')
     THEN RAISE EXCEPTION '已有正式资金事实的采购来源不能删除' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.jg_spot_ledger_delete_guard() FROM PUBLIC;
CREATE TRIGGER jg_spot_ledger_delete_guard BEFORE DELETE ON public."SpotProcurementPayment" FOR EACH ROW EXECUTE FUNCTION public.jg_spot_ledger_delete_guard();
CREATE TRIGGER jg_spot_ledger_delete_guard BEFORE DELETE ON public."SpotProcurement" FOR EACH ROW EXECUTE FUNCTION public.jg_spot_ledger_delete_guard();

CREATE FUNCTION public.jg_delete_unsubmitted_tax_revision(p_id TEXT,p_actor TEXT,p_updated TIMESTAMP)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public."ContractTaxFactRevision"%ROWTYPE;
BEGIN
 SELECT * INTO item FROM public."ContractTaxFactRevision" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF item."createdByUserId"<>p_actor OR p_updated IS NULL OR item."updatedAt"<>p_updated
   OR NOT EXISTS(SELECT 1 FROM public."User" WHERE id=p_actor AND "isActive")
   OR item.status<>'draft' OR item."submittedAt" IS NOT NULL OR item."financeReviewedAt" IS NOT NULL OR item."confirmedAt" IS NOT NULL
   OR EXISTS(SELECT 1 FROM public."ApprovalInstance" WHERE "businessId"=p_id)
 THEN RETURN FALSE; END IF;
 DELETE FROM public."ContractTaxFactRevision" WHERE id=p_id;
 INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId",metadata)
 VALUES(gen_random_uuid()::text,p_actor,'contract.tax_fact_revision.draft.delete','contract_tax_fact_revision',p_id,
 jsonb_build_object('projectId',item."projectId",'contractId',item."contractId",'contractVersionId',item."contractVersionId",'revisionNo',item."revisionNo",'previousStatus',item.status,'kind',item.kind,'updatedAt',item."updatedAt",'files',public.jg_draft_deletion_file_audit(ARRAY[item."evidenceFileId"])));
 RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_tax_revision(TEXT,TEXT,TIMESTAMP) FROM PUBLIC;

CREATE FUNCTION public.jg_delete_unsubmitted_operating_batch(p_id TEXT,p_actor TEXT,p_project TEXT,p_revision INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE item public."OperatingTakeoverBatch"%ROWTYPE;
BEGIN
 SELECT * INTO item FROM public."OperatingTakeoverBatch" WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF item."createdByUserId"<>p_actor OR p_project IS NULL OR item."projectId"<>p_project OR p_revision IS NULL OR item.revision<>p_revision
   OR NOT EXISTS(SELECT 1 FROM public."User" WHERE id=p_actor AND "isActive") OR item.status NOT IN('draft','under_review') OR item."activatedAt" IS NOT NULL
   OR EXISTS(SELECT 1 FROM public."OperatingTakeoverConfirmation" WHERE "batchId"=p_id)
   OR EXISTS(SELECT 1 FROM public."OperatingTakeoverActivation" WHERE "batchId"=p_id)
   OR EXISTS(SELECT 1 FROM public."OperatingTakeoverRow" WHERE "batchId"=p_id AND "generatedFactId" IS NOT NULL)
   OR EXISTS(SELECT 1 FROM public."OperatingTakeoverRowMapping" WHERE "sourceBusinessId"=p_id OR "sourceBusinessId" IN(SELECT id FROM public."OperatingTakeoverRow" WHERE "batchId"=p_id))
 THEN RETURN FALSE; END IF;
 INSERT INTO public."AuditLog"(id,"actorUserId",action,"businessType","businessId",metadata)
 VALUES(gen_random_uuid()::text,p_actor,'operating_takeover.draft.delete','operating_takeover_batch',p_id,
 jsonb_build_object('projectId',item."projectId",'batchNo',item."batchNo",'importFingerprint',item."importFingerprint",'sourceFileId',item."sourceFileId",'revision',item.revision,'previousStatus',item.status,
 'deletedReferences',jsonb_build_object('rowIds',ARRAY(SELECT id FROM public."OperatingTakeoverRow" WHERE "batchId"=p_id ORDER BY id),'issueIds',ARRAY(SELECT id FROM public."OperatingTakeoverIssue" WHERE "batchId"=p_id ORDER BY id),'attachmentGroupIds',ARRAY(SELECT id FROM public."OperatingTakeoverAttachmentGroup" WHERE "batchId"=p_id ORDER BY id)),
 'files',public.jg_draft_deletion_file_audit(ARRAY(SELECT item."sourceFileId" UNION SELECT "fileId" FROM public."OperatingTakeoverAttachmentLink" WHERE "groupId" IN(SELECT id FROM public."OperatingTakeoverAttachmentGroup" WHERE "batchId"=p_id)))));
 DELETE FROM public."OperatingTakeoverAttachmentLink" WHERE "groupId" IN(SELECT id FROM public."OperatingTakeoverAttachmentGroup" WHERE "batchId"=p_id);
 DELETE FROM public."OperatingTakeoverAttachmentGroup" WHERE "batchId"=p_id;
 DELETE FROM public."OperatingTakeoverIssue" WHERE "batchId"=p_id;
 DELETE FROM public."OperatingTakeoverRow" WHERE "batchId"=p_id;
 DELETE FROM public."OperatingTakeoverBatch" WHERE id=p_id;
 RETURN TRUE;
EXCEPTION WHEN foreign_key_violation OR check_violation THEN RETURN FALSE;
END $$;
REVOKE ALL ON FUNCTION public.jg_delete_unsubmitted_operating_batch(TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;
