-- Deployment migration-owner connection only; existing restricted application role.
\getenv runtime_role OPERATING_LEDGER_RUNTIME_ROLE
BEGIN;
SELECT set_config('app.procurement_runtime_role', :'runtime_role', true);
DO $$
DECLARE runtime_role TEXT := current_setting('app.procurement_runtime_role'); routine TEXT;
BEGIN
  IF runtime_role = current_user OR NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = runtime_role AND NOT rolsuper AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls
  ) THEN RAISE EXCEPTION 'procurement runtime must be a distinct existing restricted role'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'GeneralProcurement' AND c.relkind = 'r'
      AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'migration owner must own the procurement table';
  END IF;
  -- Existing owner defaults may have granted CRUD when this table was created.
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public."GeneralProcurement" FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public."GeneralProcurement" TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_general_procurement(TEXT,TEXT,INTEGER) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_expense_claim(TEXT,TEXT,TIMESTAMP) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_settlement(TEXT,TEXT,INTEGER) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_takeover(TEXT,TEXT,TIMESTAMP) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_spot_payment(TEXT,TEXT,TIMESTAMP,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_spot_procurement(TEXT,TEXT) TO %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_tax_revision(TEXT,TEXT,TIMESTAMP) TO %I', runtime_role);
  -- 323 尾部新增的只读 SECURITY DEFINER 包装（付款详情/合同变更/履约成本等）。
  -- 应用运行时角色必须能执行这些只读函数，但不能读其背后的 owner-only 表；
  -- 旧前缀没有这些函数时逐条跳过，保持最小权限且不改变既有部署。
  FOR routine IN
    SELECT signature FROM unnest(ARRAY[
      'public.jg_read_payment_detail_activity_v1(text,text,text)',
      'public.jg_read_payment_detail_allocations_v1(text,text,text)',
      'public.jg_read_payment_detail_pdf_v1(text,text,text)',
      'public.jg_read_payment_detail_snapshots_v1(text,text,text,boolean)',
      'public.jg_read_payment_contract_agreement_detail_v1(text,text,text)',
      'public.jg_read_effective_contract_change_amount_v1(text,text,text)',
      'public.jg_read_text_payment_agreement_v1(text,text,text,text)'
    ]) AS signature
  LOOP
    IF pg_catalog.to_regprocedure(routine) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', routine, runtime_role);
    END IF;
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_delete_unsubmitted_operating_batch(TEXT,TEXT,TEXT,INTEGER) TO %I', runtime_role);
  IF pg_catalog.to_regprocedure('public.jg_append_text_payment_allocation_v1(text)') IS NOT NULL THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_append_text_payment_allocation_v1(text) TO %I', runtime_role);
  END IF;

  routine := 'public.jg_record_expense_public_cash_voucher(text,text,bigint,timestamp,text,text,text,text,text)';
  IF pg_catalog.to_regprocedure(routine) IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON TABLE public.jg_expense_public_cash_voucher_witness FROM %I', runtime_role);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', routine, runtime_role);
    IF NOT pg_catalog.has_function_privilege(runtime_role, routine, 'EXECUTE')
      OR pg_catalog.has_function_privilege(runtime_role, routine, 'EXECUTE WITH GRANT OPTION')
      OR pg_catalog.has_function_privilege(runtime_role, 'public.jg_finish_expense_public_cash_voucher()', 'EXECUTE')
      OR pg_catalog.has_table_privilege(runtime_role, 'public.jg_expense_public_cash_voucher_witness',
        'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
      OR pg_catalog.has_any_column_privilege(runtime_role, 'public.jg_expense_public_cash_voucher_witness',
        'SELECT, INSERT, UPDATE, REFERENCES') THEN
      RAISE EXCEPTION 'expense cash voucher runtime privileges must be limited to the controlled writer';
    END IF;
  END IF;

  FOR routine IN
    SELECT signature FROM unnest(ARRAY[
      'public.jg_read_payment_detail_activity_v1(text,text,text)',
      'public.jg_read_payment_detail_allocations_v1(text,text,text)',
      'public.jg_read_payment_detail_pdf_v1(text,text,text)',
      'public.jg_read_payment_detail_snapshots_v1(text,text,text,boolean)',
      'public.jg_read_payment_contract_agreement_detail_v1(text,text,text)',
      'public.jg_read_effective_contract_change_amount_v1(text,text,text)',
      'public.jg_read_text_payment_agreement_v1(text,text,text,text)'
    ]) AS signature
  LOOP
    IF pg_catalog.to_regprocedure(routine) IS NOT NULL
      AND NOT has_function_privilege(runtime_role, routine, 'EXECUTE') THEN
      RAISE EXCEPTION 'payment detail read execute grant missing: %', routine;
    END IF;
  END LOOP;  IF NOT has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'SELECT')
    OR NOT has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'INSERT')
    OR NOT has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'UPDATE')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'DELETE')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'TRUNCATE')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'REFERENCES')
    OR has_table_privilege(runtime_role, 'public."GeneralProcurement"', 'TRIGGER') THEN
    RAISE EXCEPTION 'procurement runtime privileges must be limited to select insert update';
  END IF;
END;
$$;
COMMIT;
