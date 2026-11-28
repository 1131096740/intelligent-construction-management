CREATE TABLE public."RegisteredPrincipalReturnSource" (
 "kind" TEXT NOT NULL CHECK ("kind" IN ('advance_receipt','payment_advance')),
 "sourceId" TEXT NOT NULL,
 "writeRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("writeRevision" >= 0),
 PRIMARY KEY ("kind","sourceId")
);
CREATE TABLE public."RegisteredPrincipalReturnApplication" (
 "id" TEXT PRIMARY KEY,
 "sourceKind" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL,
 "projectId" TEXT REFERENCES public."Project"("id") ON DELETE RESTRICT,
 "contributorName" TEXT NOT NULL CHECK (length(btrim("contributorName")) > 0),
 "requestedYuan" DECIMAL(24,4) NOT NULL CHECK ("requestedYuan" > 0 AND "requestedYuan" <> 'NaN'::numeric),
 "approvedYuan" DECIMAL(24,4) CHECK ("approvedYuan" >= 0 AND "approvedYuan" <= "requestedYuan"),
 "paidYuan" DECIMAL(24,4) NOT NULL DEFAULT 0 CHECK ("paidYuan" >= 0 AND "paidYuan" <= coalesce("approvedYuan",0)),
 "reason" TEXT NOT NULL CHECK (length(btrim("reason")) > 0),
 "status" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "approvalInstanceId" TEXT NOT NULL UNIQUE REFERENCES public."ApprovalInstance"("id") ON DELETE RESTRICT,
 "createdByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("sourceKind","sourceId") REFERENCES public."RegisteredPrincipalReturnSource"("kind","sourceId") ON DELETE RESTRICT,
 CHECK (("status" IN ('pending','rejected') AND "approvedYuan" IS NULL AND "paidYuan" = 0)
   OR ("status" = 'withdrawn' AND coalesce("approvedYuan",0) = 0 AND "paidYuan" = 0)
   OR ("status" = 'approved' AND "approvedYuan" IS NOT NULL AND "approvedYuan" > 0 AND "paidYuan" = 0)
   OR ("status" = 'partially_paid' AND "approvedYuan" IS NOT NULL AND "paidYuan" > 0 AND "paidYuan" < "approvedYuan")
   OR ("status" = 'paid' AND "approvedYuan" IS NOT NULL AND "paidYuan" > 0 AND "paidYuan" = "approvedYuan"))
);
CREATE INDEX "RegisteredPrincipalReturnApplication_sourceKind_sourceId_idx" ON public."RegisteredPrincipalReturnApplication"("sourceKind","sourceId");
CREATE TABLE public."RegisteredPrincipalReturnPayment" (
 "id" TEXT PRIMARY KEY,
 "applicationId" TEXT NOT NULL REFERENCES public."RegisteredPrincipalReturnApplication"("id") ON DELETE RESTRICT,
 "accountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT,
 "scopeKey" TEXT NOT NULL,
 "previousRegistrationId" TEXT NOT NULL REFERENCES public."FundAccountBalanceRegistration"("id") ON DELETE RESTRICT,
 "registrationId" TEXT NOT NULL UNIQUE REFERENCES public."FundAccountBalanceRegistration"("id") ON DELETE RESTRICT,
 "amountYuan" DECIMAL(24,4) NOT NULL CHECK ("amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric),
 "paidOn" TEXT NOT NULL CHECK ("paidOn" ~ '^\d{4}-\d{2}-\d{2}$'),
 "evidenceReference" TEXT NOT NULL CHECK (length(btrim("evidenceReference")) > 0),
 "paidByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "RegisteredPrincipalReturnPayment_applicationId_idx" ON public."RegisteredPrincipalReturnPayment"("applicationId");
CREATE TABLE public."RegisteredPrincipalReturnAllocation" (
 "paymentId" TEXT NOT NULL REFERENCES public."RegisteredPrincipalReturnPayment"("id") ON DELETE RESTRICT,
 "sourceBatchId" TEXT NOT NULL REFERENCES public."FundAccountSourceBatch"("id") ON DELETE RESTRICT,
 "amountYuan" DECIMAL(24,4) NOT NULL CHECK ("amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric),
 PRIMARY KEY ("paymentId","sourceBatchId")
);
CREATE TABLE public."RegisteredPrincipalReturnCommand" (
 "idempotencyKey" TEXT PRIMARY KEY,
 "applicationId" TEXT NOT NULL REFERENCES public."RegisteredPrincipalReturnApplication"("id") ON DELETE RESTRICT,
 "paymentId" TEXT UNIQUE REFERENCES public."RegisteredPrincipalReturnPayment"("id") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "action" TEXT NOT NULL CHECK ("action" IN ('apply','approve','reject','withdraw','reduce','pay')),
 "applicationRevision" INTEGER NOT NULL CHECK ("applicationRevision" > 0),
 "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("applicationId","applicationRevision"),
 CHECK (("action" = 'pay') = ("paymentId" IS NOT NULL))
);
ALTER TABLE public."FundAccountBalanceRegistration"
 DROP CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check",
 ADD CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check" CHECK (
 ("kind" = 'opening' AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" = 1 AND "previousRegistrationId" IS NULL AND "status" = 'confirmed')
 OR ("kind" = 'correction' AND "transferId" IS NULL AND "approvalInstanceId" IS NOT NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" IN ('pending_review','confirmed','returned','withdrawn'))
 OR ("kind" = 'transfer' AND "transferId" IS NOT NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL)
 OR ("kind" IN ('advance_receipt','principal_return') AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL));

CREATE FUNCTION public."jg_registered_principal_return_immutable"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'RegisteredPrincipalReturnApplication' AND
   (to_jsonb(NEW) - ARRAY['status','approvedYuan','paidYuan','revision']) =
   (to_jsonb(OLD) - ARRAY['status','approvedYuan','paidYuan','revision']) AND
   NEW."revision" = OLD."revision" + 1 AND NEW."paidYuan" >= OLD."paidYuan" AND
   ((OLD."status" = 'pending' AND NEW."status" IN ('pending','rejected','withdrawn','approved')) OR
    (OLD."status" IN ('approved','partially_paid') AND NEW."status" IN ('approved','partially_paid','paid','withdrawn')
     AND NEW."approvedYuan" <= OLD."approvedYuan")) THEN RETURN NEW;
 END IF;
 RAISE EXCEPTION 'principal return facts are append-only';
END $$;
CREATE TRIGGER "RegisteredPrincipalReturnApplication_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPrincipalReturnApplication"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_immutable"();
CREATE TRIGGER "RegisteredPrincipalReturnPayment_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPrincipalReturnPayment"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_immutable"();
CREATE TRIGGER "RegisteredPrincipalReturnAllocation_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPrincipalReturnAllocation"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_immutable"();
CREATE TRIGGER "RegisteredPrincipalReturnCommand_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPrincipalReturnCommand"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_immutable"();

CREATE FUNCTION public."jg_registered_principal_return_application_check"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE app public."RegisteredPrincipalReturnApplication"; principal_amount NUMERIC; origin_project TEXT; origin_name TEXT; occupied NUMERIC;
BEGIN
 SELECT * INTO STRICT app FROM public."RegisteredPrincipalReturnApplication" WHERE id = NEW.id;
 IF NOT EXISTS (SELECT 1 FROM public."RegisteredPrincipalReturnSource" src WHERE src.kind = app."sourceKind"
   AND src."sourceId" = app."sourceId" AND src.xmin::text = (txid_current() % 4294967296)::text) THEN
   RAISE EXCEPTION 'principal return application requires current origin write revision';
 END IF;
 IF app."sourceKind" = 'advance_receipt' THEN
   SELECT receipt."amountYuan",receipt."projectId",receipt."contributorNameSnapshot" INTO principal_amount,origin_project,origin_name
    FROM public."RegisteredFundAdvanceReceipt" receipt WHERE receipt.id = app."sourceId" AND receipt."contributorId" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public."RegisteredFundCompanyOwnedReceipt" owned WHERE owned."receiptId" = receipt.id);
 ELSE
   SELECT advance."amountCents"::numeric / 100,advance."projectId",funding."actualPayerSnapshot"->>'name'
     INTO principal_amount,origin_project,origin_name
    FROM public."RegisteredPaymentProjectAdvance" advance JOIN public."RegisteredPaymentFunding" funding
     ON funding."executionId" = advance."executionId" AND funding."actualPayerId" = advance."creditorCompanyId"
    WHERE advance."executionId" = app."sourceId";
 END IF;
 IF principal_amount IS NULL OR nullif(btrim(origin_name),'') IS NULL OR app."projectId" IS DISTINCT FROM origin_project OR
   (TG_OP = 'INSERT' AND app."contributorName" IS DISTINCT FROM origin_name) THEN
   RAISE EXCEPTION 'principal return requires confirmed contributor and original principal';
 END IF;
 SELECT coalesce(sum(CASE WHEN candidate."status" = 'pending' THEN candidate."requestedYuan"
   ELSE coalesce(candidate."approvedYuan",0) END),0) INTO occupied
 FROM public."RegisteredPrincipalReturnApplication" candidate WHERE candidate."sourceKind" = app."sourceKind" AND candidate."sourceId" = app."sourceId";
 IF occupied > principal_amount OR app."paidYuan" <> (SELECT coalesce(sum(payment."amountYuan"),0)
   FROM public."RegisteredPrincipalReturnPayment" payment WHERE payment."applicationId" = app.id) THEN
   RAISE EXCEPTION 'principal return reservation or payment exceeds original principal';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public."ApprovalInstance" round WHERE round.id = app."approvalInstanceId"
   AND round."businessType" = 'registered_principal_return' AND round."flowType" = 'registered_principal_return'
   AND round."businessId" = app.id AND round."applicantUserId" = app."createdByUserId"
   AND ((app.status = 'pending' AND round.status = 'approval_pending') OR
     (app.status = 'rejected' AND round.status = 'rejected') OR
     (app.status = 'withdrawn' AND round.status IN ('withdrawn','approved')) OR
     (app.status IN ('approved','partially_paid','paid') AND round.status = 'approved')))
   OR NOT EXISTS (SELECT 1 FROM public."RegisteredPrincipalReturnCommand" command
     WHERE command."applicationId" = app.id AND command."applicationRevision" = app.revision) THEN
   RAISE EXCEPTION 'principal return requires its exact approval and command evidence';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredPrincipalReturnApplication_principal" AFTER INSERT OR UPDATE ON public."RegisteredPrincipalReturnApplication"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_application_check"();

CREATE FUNCTION public."jg_registered_principal_return_registration_start"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF NEW."kind" = 'principal_return' AND NOT EXISTS (
   SELECT 1 FROM public."RegisteredFundAccount" account
   JOIN LATERAL (SELECT a.id FROM public."FundAccountBalanceRegistration" a
     WHERE a."accountId" = account.id AND a.status = 'confirmed' ORDER BY a.version DESC LIMIT 1) active ON true
   WHERE account.id = NEW."accountId" AND active.id = NEW."previousRegistrationId"
   AND account.xmin::text = (txid_current() % 4294967296)::text
 ) THEN RAISE EXCEPTION 'principal return requires confirmed current account and write revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FundAccountBalanceRegistration_principal_return_start" BEFORE INSERT ON public."FundAccountBalanceRegistration"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_registration_start"();

CREATE FUNCTION public."jg_registered_principal_return_payment_check"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE payment public."RegisteredPrincipalReturnPayment"; prior public."FundAccountBalanceRegistration"; snapshot public."FundAccountBalanceRegistration";
BEGIN
 IF TG_TABLE_NAME = 'FundAccountBalanceRegistration' THEN
   IF NEW.kind <> 'principal_return' THEN RETURN NULL; END IF;
   SELECT * INTO STRICT payment FROM public."RegisteredPrincipalReturnPayment" WHERE "registrationId" = NEW.id;
 ELSE
   SELECT * INTO STRICT payment FROM public."RegisteredPrincipalReturnPayment" WHERE id = NEW.id;
 END IF;
 SELECT * INTO STRICT prior FROM public."FundAccountBalanceRegistration" WHERE id = payment."previousRegistrationId";
 SELECT * INTO snapshot FROM public."FundAccountBalanceRegistration" WHERE id = payment."registrationId";
 IF snapshot.id IS NULL OR snapshot.kind <> 'principal_return' OR prior."accountId" <> payment."accountId" OR snapshot."accountId" <> payment."accountId"
  OR snapshot."previousRegistrationId" IS DISTINCT FROM prior.id OR prior."balanceYuan" IS NULL
  OR snapshot."balanceYuan" <> prior."balanceYuan" - payment."amountYuan"
  OR snapshot."coveredExecutionIds" IS DISTINCT FROM prior."coveredExecutionIds"
  OR snapshot."asOfDate" IS DISTINCT FROM prior."asOfDate"
  OR NOT EXISTS (SELECT 1 FROM public."RegisteredFundAccount" account WHERE account.id = payment."accountId" AND account."scopeKey" = payment."scopeKey")
  OR payment."amountYuan" <> (SELECT coalesce(sum(line."amountYuan"),0) FROM public."RegisteredPrincipalReturnAllocation" line WHERE line."paymentId" = payment.id)
  OR NOT EXISTS (SELECT 1 FROM public."RegisteredPrincipalReturnCommand" command
     WHERE command."paymentId" = payment.id AND command."applicationId" = payment."applicationId" AND command."actorUserId" = payment."paidByUserId")
  OR NOT EXISTS (SELECT 1 FROM public."RegisteredPrincipalReturnApplication" app WHERE app.id = payment."applicationId"
    AND app.xmin::text = (txid_current() % 4294967296)::text)
 THEN RAISE EXCEPTION 'principal return requires one balanced debit and its command'; END IF;
 IF EXISTS (
   SELECT 1 FROM public."RegisteredPrincipalReturnAllocation" line
   JOIN public."FundAccountSourceBatch" batch ON batch.id = line."sourceBatchId"
   WHERE line."paymentId" = payment.id AND batch."registrationId" <> prior.id
 ) OR (SELECT count(*) FROM public."FundAccountSourceBatch" batch WHERE batch."registrationId" = snapshot.id) <>
      (SELECT count(*) FROM public."FundAccountSourceBatch" batch WHERE batch."registrationId" = prior.id)
 OR EXISTS (
   SELECT 1 FROM public."FundAccountSourceBatch" parent
   LEFT JOIN LATERAL (SELECT count(*) AS matches FROM public."FundAccountSourceBatch" child
     WHERE child."registrationId" = snapshot.id AND child."previousSourceBatchId" = parent.id
       AND child."sourceStatus" = parent."sourceStatus" AND child."sourceName" IS NOT DISTINCT FROM parent."sourceName"
       AND child."projectStatus" = parent."projectStatus" AND child."projectId" IS NOT DISTINCT FROM parent."projectId"
       AND child."amountYuan" = parent."amountYuan" - coalesce((SELECT line."amountYuan"
         FROM public."RegisteredPrincipalReturnAllocation" line WHERE line."sourceBatchId" = parent.id AND line."paymentId" = payment.id),0)
   ) children ON true WHERE parent."registrationId" = prior.id AND children.matches <> 1
 ) THEN RAISE EXCEPTION 'principal return changes original source coordinates or duplicates the debit'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredPrincipalReturnPayment_conservation" AFTER INSERT ON public."RegisteredPrincipalReturnPayment"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_payment_check"();
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_principal_return" AFTER INSERT ON public."FundAccountBalanceRegistration"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.kind = 'principal_return')
 EXECUTE FUNCTION public."jg_registered_principal_return_payment_check"();

CREATE FUNCTION public."jg_registered_principal_return_allocation_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public."RegisteredPrincipalReturnPayment" payment WHERE payment.id = NEW."paymentId"
   AND payment.xmin::text = (txid_current() % 4294967296)::text) THEN
   RAISE EXCEPTION 'principal return source allocations must share the payment transaction';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredPrincipalReturnAllocation_insert" BEFORE INSERT ON public."RegisteredPrincipalReturnAllocation"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_principal_return_allocation_insert"();
