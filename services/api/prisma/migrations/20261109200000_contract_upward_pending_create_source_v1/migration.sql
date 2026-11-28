-- Detached create-row guard only. This file does not alter the existing
-- dispatcher or supply an application role, write grant or file authority.
BEGIN;

-- Intentionally empty until the separate, matched dispatcher installation.
CREATE TABLE public.jg_contract_upward_pending_create_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "ownerOid" OID NOT NULL,
  "directDispatchSha256" TEXT NOT NULL CHECK ("directDispatchSha256"~'^[a-f0-9]{64}$'),
  "versionTriggerOid" OID NOT NULL,
  "versionRoutineOid" OID NOT NULL,
  "attachmentTriggerOid" OID NOT NULL,
  "helperOid" OID NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_upward_pending_create_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_upward_pending_create_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $upward_binding$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '对上创建资格绑定不可改写或清空' USING ERRCODE='23514';
  END IF;
  IF current_user::regrole::oid IS DISTINCT FROM NEW."ownerOid"
    OR EXISTS (SELECT 1 FROM public.jg_contract_upward_pending_create_binding_v1) THEN
    RAISE EXCEPTION '对上创建资格绑定只允许可信安装身份提供' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$upward_binding$;
REVOKE ALL ON FUNCTION public.jg_guard_upward_pending_create_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_upward_pending_create_binding_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_upward_pending_create_binding_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_upward_pending_create_binding_v1();
CREATE TRIGGER jg_upward_pending_create_binding_no_truncate BEFORE TRUNCATE
ON public.jg_contract_upward_pending_create_binding_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_upward_pending_create_binding_v1();

CREATE FUNCTION public.jg_guard_contract_upward_pending_create_v1(candidate public."ContractVersion")
RETURNS public."ContractVersion"
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $upward_create$
DECLARE marker JSONB := candidate."draftData"->'directSigningInput'; owner_contract RECORD;
BEGIN
  SELECT c."contractTypeKey" AS business_type, c."ownerUserId" AS handler_id INTO owner_contract
    FROM public."Contract" c JOIN public."Project" p ON p."id"=c."projectId" AND p."isActive"
    WHERE c."id"=candidate."contractId" AND c."voidedAt" IS NULL AND c."code" IS NULL
      AND c."companyEntityId" IS NULL AND c."name"='' AND c."counterparty"='';
  IF NOT FOUND OR owner_contract.handler_id IS NULL OR owner_contract.business_type NOT IN
    ('material_purchase','equipment_rental','labor_subcontract','professional_subcontract','other')
    OR EXISTS (SELECT 1 FROM public."ContractVersion" cv WHERE cv."contractId"=candidate."contractId")
    OR candidate."versionNo" IS DISTINCT FROM 1 OR candidate."draftRevision" IS DISTINCT FROM 1
    OR candidate."numericProtocolVersion" IS DISTINCT FROM 2 OR candidate."changeType" IS DISTINCT FROM 'original'
    OR candidate."status" IS DISTINCT FROM 'draft' OR candidate."signingSubjectType" IS DISTINCT FROM 'draft_unconfirmed'
    OR candidate."amountCents" IS DISTINCT FROM 0 OR candidate."amountYuan" IS NOT NULL OR candidate."estimatedAmountCents" IS NOT NULL
    OR candidate."amountLimitType" NOT IN ('capped','unlimited') OR candidate."pricingNature" IS DISTINCT FROM 'unit_price'
    OR candidate."amountSource" IS DISTINCT FROM 'bill_sum'
    OR candidate."taxFactStatus" IS DISTINCT FROM 'draft' OR candidate."taxFactSource" IS DISTINCT FROM 'contract_document'
    OR candidate."invoiceType" IS NOT NULL OR candidate."defaultTaxRatePercent" IS NOT NULL OR candidate."taxFactsFrozenAt" IS NOT NULL
    OR candidate."originalSignedNumber" IS NOT NULL OR candidate."firstSubmittedAt" IS NOT NULL OR candidate."effectiveAt" IS NOT NULL
    OR candidate."abandonedAt" IS NOT NULL OR candidate."endedAt" IS NOT NULL
    OR candidate."baseVersionId" IS NOT NULL OR candidate."supersedesVersionId" IS NOT NULL OR candidate."copiedFromContractVersionId" IS NOT NULL
    OR candidate."documentContentFingerprint" IS NOT NULL OR candidate."latestDraftPreviewDocumentId" IS NOT NULL
    OR candidate."businessTemplateVersionId" IS NOT NULL OR candidate."layoutTemplateVersionId" IS NOT NULL
    OR candidate."companyEntityIdSnapshot" IS NOT NULL OR candidate."companyEntityVersionId" IS NOT NULL
    OR candidate."companyEntityNameSnapshot" IS NOT NULL OR candidate."companyEntityCreditCodeSnapshot" IS NOT NULL
    OR candidate."companyEntityRegisteredAddressSnapshot" IS NOT NULL
    OR candidate."affiliateAssignmentId" IS NOT NULL OR candidate."affiliateBusinessPartyVersionId" IS NOT NULL
    OR candidate."affiliateNameSnapshot" IS NOT NULL OR candidate."affiliateCreditCodeSnapshot" IS NOT NULL
    OR marker IS DISTINCT FROM '{"protocolVersion":2,"source":"direct_signed","relationship":"upward","signedOn":null,"enterpriseParty":null,"companyParty":null,"companyParticipationId":null,"fixedPaymentTermsVersionId":null}'::jsonb
    OR candidate."draftData" IS DISTINCT FROM jsonb_build_object(
      'directSigningInput',marker,'contractName','','fieldValues','{}'::jsonb,'partyValues','{}'::jsonb,
      'contractBasics',jsonb_build_object('relationship','upward','businessType',owner_contract.business_type,
        'amountBasis','tax_inclusive','invoiceStatus','pending','settlementText',''))
  THEN
    RAISE EXCEPTION '对上已签草稿的初始资料或办理来源不匹配' USING ERRCODE='23514';
  END IF;
  RETURN candidate;
END;
$upward_create$;

REVOKE ALL ON FUNCTION public.jg_guard_contract_upward_pending_create_v1(public."ContractVersion") FROM PUBLIC;
COMMIT;
