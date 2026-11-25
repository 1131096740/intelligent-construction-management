BEGIN;

-- Preserve legacy levels and admit the current no-grade historical workflow.
ALTER TABLE public."ContractTakeover"
  DROP CONSTRAINT "ContractTakeover_level_check",
  ADD CONSTRAINT "ContractTakeover_level_check"
    CHECK ("takeoverLevel" IN ('A', 'B', 'C', 'NONE'));

-- Handover events are separate from contract and finance confirmation events.
ALTER TABLE public."ContractTakeoverConfirmationEvent"
  DROP CONSTRAINT "ContractTakeoverConfirmationEvent_side_check",
  DROP CONSTRAINT "ContractTakeoverConfirmationEvent_action_check",
  ADD CONSTRAINT "ContractTakeoverConfirmationEvent_side_check"
    CHECK ("side" IN ('contract', 'finance', 'handover')),
  ADD CONSTRAINT "ContractTakeoverConfirmationEvent_action_check"
    CHECK (
      ("side" IN ('contract', 'finance') AND "action" IN ('confirm', 'withdraw'))
      OR ("side" = 'handover' AND "action" IN ('handover_register', 'handover_reassign'))
    );

COMMIT;
