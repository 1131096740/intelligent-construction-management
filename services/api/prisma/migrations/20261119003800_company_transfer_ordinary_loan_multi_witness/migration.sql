BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

LOCK TABLE public.jg_company_transfer_loan_repayment_scope_v1 IN ACCESS EXCLUSIVE MODE;

DO $preflight$
DECLARE
  scope_table oid := 'public.jg_company_transfer_loan_repayment_scope_v1'::regclass;
  owner_oid oid := current_user::regrole::oid;
  expected record;
  routine pg_proc%ROWTYPE;
BEGIN
  IF EXISTS (SELECT FROM public.jg_company_transfer_loan_repayment_scope_v1)
    OR NOT EXISTS (
      SELECT FROM pg_class c
      WHERE c.oid=scope_table AND c.relowner=owner_oid AND c.relkind='r'
        AND NOT EXISTS (
          SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
          WHERE acl.grantee<>owner_oid
        )
    )
    OR EXISTS (
      SELECT FROM pg_attribute a, LATERAL aclexplode(a.attacl) acl
      WHERE a.attrelid=scope_table AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>owner_oid
    )
    OR NOT EXISTS (
      SELECT FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='singleton'
      WHERE c.conrelid=scope_table AND c.conname='jg_company_transfer_loan_repayment_scope_v1_pkey'
        AND c.contype='p' AND c.convalidated AND NOT c.condeferrable AND c.conkey=ARRAY[a.attnum]
    )
    OR NOT EXISTS (
      SELECT FROM pg_constraint c
      WHERE c.conrelid=scope_table AND c.contype='c' AND c.convalidated
        AND pg_get_expr(c.conbin,c.conrelid)='singleton'
    )
  THEN
    RAISE EXCEPTION 'company_transfer_ordinary_multi_witness_preimage';
  END IF;

  -- The unchanged routines must still consume the exact request, approval and payout coordinates.
  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_check_company_transfer_loan_repayment_insert_v1()',
      '5840396ff6f1fa7c30f3c39eb2417aab82acd988e203c4894e4118af1834de2f', 'search_path=pg_catalog, public, pg_temp'),
    ('public.jg_check_company_transfer_loan_repayment_approval_v1()',
      '506570362fdedab705561592137d94298b2614e6dbca92dbe934d96df641e01b', 'search_path=pg_catalog, public, pg_temp'),
    ('public.jg_company_transfer_ordinary_payout_checkpoints(text,text,text)',
      '7296038bd7811de0918aa06044ce0b824f4010d18ca5997df77139ceb9a7d29f', 'search_path=pg_catalog, pg_temp')
  ) AS pins(signature,digest,path_setting)
  LOOP
    SELECT * INTO STRICT routine FROM pg_proc WHERE oid=expected.signature::regprocedure;
    IF routine.proowner<>owner_oid OR NOT routine.prosecdef
      OR routine.proconfig IS DISTINCT FROM ARRAY[expected.path_setting]
      OR encode(sha256(convert_to(routine.prosrc,'UTF8')),'hex')<>expected.digest
      OR EXISTS (
        SELECT FROM aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) acl
        WHERE acl.grantee<>owner_oid
      )
    THEN
      RAISE EXCEPTION 'company_transfer_ordinary_multi_witness_routine';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT FROM (VALUES
      ('CompanyTransfer_original_capacity_insert_loan','public.jg_check_company_transfer_loan_repayment_insert_v1()',7::smallint),
      ('CompanyTransfer_original_capacity_update_loan','public.jg_check_company_transfer_loan_repayment_approval_v1()',19::smallint)
    ) AS expected_trigger(trigger_name,signature,trigger_type)
    WHERE NOT EXISTS (
      SELECT FROM pg_trigger t
      WHERE t.tgrelid='public."CompanyTransfer"'::regclass AND t.tgname=expected_trigger.trigger_name
        AND t.tgfoid=expected_trigger.signature::regprocedure AND t.tgtype=expected_trigger.trigger_type
        AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgnargs=0 AND t.tgqual IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'company_transfer_ordinary_multi_witness_triggers';
  END IF;
END
$preflight$;

-- Keep the fixed true marker for the existing routines. Each request now has its own witness.
ALTER TABLE public.jg_company_transfer_loan_repayment_scope_v1
  DROP CONSTRAINT jg_company_transfer_loan_repayment_scope_v1_pkey,
  ADD PRIMARY KEY (request_key),
  ADD CONSTRAINT loan_repayment_scope_repayment_key UNIQUE (repayment_id),
  ADD CONSTRAINT loan_repayment_scope_approval_key UNIQUE (approval_id);

COMMIT;
