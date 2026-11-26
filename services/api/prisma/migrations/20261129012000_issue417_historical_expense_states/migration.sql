BEGIN;

ALTER TABLE public."OperatingTakeoverRow"
  DROP CONSTRAINT "OperatingTakeoverRow_status_check",
  ADD CONSTRAINT "OperatingTakeoverRow_status_check" CHECK (
    "reviewStatus" IN ('pending', 'accepted', 'blocked', 'activated')
    OR ("sceneKey" = 'historical_expense' AND "reviewStatus" IN ('verified', 'not_occurred'))
  );

ALTER TABLE public."OperatingTakeoverBatch"
  DROP CONSTRAINT "OperatingTakeoverBatch_status_check",
  ADD CONSTRAINT "OperatingTakeoverBatch_status_check" CHECK (
    "status" IN ('draft', 'under_review', 'activated')
    OR ("sceneKeys" = '["historical_expense"]'::jsonb AND "status" = 'partially_activated')
  );

ALTER TABLE public."OperatingTakeoverActivation"
  DROP CONSTRAINT "OperatingTakeoverActivation_status_check",
  ADD CONSTRAINT "OperatingTakeoverActivation_status_check" CHECK (
    "status" IN ('activated', 'partially_activated')
  );

-- Write the owning tuple without changing its business revision. A stale
-- snapshot cannot then rewrite the batch scene after a concurrent partial activation.
CREATE FUNCTION public.jg_issue417_check_partial_activation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public."OperatingTakeoverBatch"
    SET "revision" = "revision"
    WHERE "id" = NEW."batchId" AND "sceneKeys" = '["historical_expense"]'::jsonb;
  IF NOT FOUND THEN
    RAISE EXCEPTION '仅历史费用批次允许部分入账'
      USING ERRCODE = '23514', CONSTRAINT = 'OperatingTakeoverActivation_partial_history_expense_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OperatingTakeoverActivation_partial_history_expense_check"
  BEFORE INSERT OR UPDATE OF "status", "batchId" ON public."OperatingTakeoverActivation"
  FOR EACH ROW WHEN (NEW."status" = 'partially_activated')
  EXECUTE FUNCTION public.jg_issue417_check_partial_activation();

CREATE FUNCTION public.jg_issue417_preserve_partial_activation_scene()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."OperatingTakeoverActivation"
    WHERE "batchId" = OLD."id" AND "status" = 'partially_activated'
  ) THEN
    RAISE EXCEPTION '历史费用批次部分入账期间不能变更录入场景'
      USING ERRCODE = '23514', CONSTRAINT = 'OperatingTakeoverBatch_partial_history_expense_scene_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OperatingTakeoverBatch_partial_history_expense_scene_check"
  BEFORE UPDATE OF "sceneKeys" ON public."OperatingTakeoverBatch"
  FOR EACH ROW WHEN (
    OLD."sceneKeys" = '["historical_expense"]'::jsonb AND NEW."sceneKeys" IS DISTINCT FROM OLD."sceneKeys"
  )
  EXECUTE FUNCTION public.jg_issue417_preserve_partial_activation_scene();

COMMIT;
