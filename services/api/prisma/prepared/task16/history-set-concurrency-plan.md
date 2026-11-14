# Complete historical basis set: concurrency hard gate

SOURCE_ONLY_NOT_EXECUTED. No migration, resource, SQL, PG driver, or business operation has been run for this plan. This is not proof that the current per-row SHARE locks protect against a new row.

## Current source facts

- payment-request.service.ts:1543 locks Contract for contract_due/advance capacity. Settlement execution instead takes only Settlement at :1886 before the current history check. There is no universal Contract lock in the registered branch.
- registered-payment-contract-history.ts locks existing ContractTakeover rows FOR SHARE. An absent row cannot be locked by that statement.
- contract-takeover.service.ts:2953-3035 legacy confirm uses an interactive transaction without an explicit isolation override, reads Contract, creates its historical initial Settlement, then changes takeoverStatus/historicalBalanceConfirmedAt. The function and createHistoricalInitialSettlement(:5744) do not take a common Contract FOR UPDATE or mutate a common revision.
- Department confirmation locks the takeover/facts/payments aggregate (:5115); its transaction explicitly uses Serializable. saveFinanceFacts and old draft/import/correction paths are not established to share one parent revision protocol. confirmChangeBaseline(:3069) does lock Contract, which is not evidence for every writer.

Consequently, neither a universal parent lock protocol nor a universal parent UPDATE exists in the current reviewed source. No claim is made that merely adding FOR UPDATE to the payment protects a Serializable snapshot established before another READ COMMITTED writer commits a new historical row. A lock alone is not a changed row version.

## Proposed minimum technical protocol (not yet implemented)

Use a dedicated per-contract history-write revision sentinel (not a payment, money container, historical member, balance, or cost). Pre-create it for every existing Contract in the eventual controlled migration, and create it for new Contract rows in the same transaction. Do not silently create a missing sentinel during a payment command.

All INSERT/UPDATE/DELETE changes that can alter the confirmed history-basis set must increment that sentinel through a database trigger, regardless of the writer's application route or isolation level. Cover old and new parent IDs in stable order if an identity move is possible. In particular, draft-to-confirmed, confirmed-to-inactive, changed historical paid/advance/proxy values, and every version/date used by the fingerprint must participate. This does not create or change any historical monetary facts; it only versions the read-set.

The new registered-payment path must lock the sentinel BEFORE settlement/history/account locks for every supported source. After a writer commits a sentinel UPDATE after the payment's snapshot, its attempt to lock the stale row must fail/serialize rather than accept an old empty or partial basis. A payment that gets the lock first serializes before the history change; the writer waits. This expected behavior still requires actual PG testing.

Do not touch Contract.updatedAt merely to manufacture a version: it participates in existing business versions and could widen unrelated CAS behavior. Prefer an isolated technical sentinel with an explicit contract lineage and strict revision+1 update guard. Preserve legitimate empty-draft Contract deletion behavior; any future FK/cascade/delete guard must be reviewed against existing lifecycle rules. Permanent canonical payment provenance must never consult the current sentinel, current history set, or future approval state to invalidate a committed old fact.

This proposal requires parent scope review before adding Schema/app/trigger source. Current application 6a9a/14ca/c478 is frozen and unchanged. It is NOT presented as an already complete SQL closure or as a new task34 business flow.

## Independently observable real-PG experiments: prepared only

For every case use two independent connections, real transaction barriers and recorded isolation levels. Current payment and historical member facts must be valid and have enough remaining capacity. No fake Promise concurrency or mock callback can prove these cases.

1. Payment establishes its Serializable snapshot before the other writer inserts a new confirmed historical row at READ COMMITTED; writer commits first. Payment must not commit with missing old basis or absent declaration. Expected serialization rejection/zero formal effects; query the original key afterward.
2. Same as 1 with an existing confirmed row corrected (amount/date/version) by a READ COMMITTED writer. Payment must not accept an old fingerprint.
3. Same cases with both transactions Serializable. Record actual predicate/row waits and final committed facts, not just an error code.
4. Payment takes the technical sentinel first; history writer then tries insertion/update. Verify actual blocking/order, and exactly one payment's request/funds/operating/audit consequences. Do not infer whether a later human historical declaration was semantically correct merely from serialization order.
5. Writer takes sentinel first but payment has an older snapshot; commit writer, then release payment. Verify old snapshot cannot silently use old records after waiting.
6. No existing historical rows: creation/confirmation of the first member races ordinary no-history payment. Absence is a predicate, not a lockable row; this is mandatory even when no confirmation UI was initially shown.
7. Parent identity move or deletion, if the existing domain permits it: both affected sets must be versioned, with stable lock order. Otherwise preserve the existing domain rejection instead of inventing a move capability.
8. Writer rollback: no committed historical set/revision change; original valid payment may proceed once real locking permits. Verify no fabricated revision/balance/member remains.
9. Valid payment commits, then a later history change commits. Original key/result and canonical source replay stay valid, with no second payment, funds debit, cost, or intercompany root.

Independent checks must include Execution, request/settlement paid and remaining capacity, Funding/source postings, Event, one audit consequence, canonical Fact/Impact, intercompany root, frozen historical values and sentinel revision. Failure/unknown responses retain the original key. No experiment is authorized or executed by this document; actual resource/SQL/migration execution remains separately authorized by the user.

## Revised concrete protocol for parent review (supersedes blocking-lock proposal)

A plain blocking marker lock in a row trigger is NOT acceptable: an existing historical writer may already hold a Takeover/Settlement/version row, then wait for a payment-owned marker while the payment waits for its row. The proposed common sentinel protocol therefore uses FOR UPDATE NOWAIT on BOTH entry paths, and removes payment-side FOR SHARE locks on historical rows after the sentinel is held. No application/active Schema/client change has been made.

Proposed technical table (DDL still only a design):

```sql
CREATE TABLE public."RegisteredContractHistoryRevision" (
  "contractId" TEXT PRIMARY KEY REFERENCES public."Contract"("id") ON DELETE CASCADE,
  "revision" BIGINT NOT NULL DEFAULT 0 CHECK ("revision" >= 0)
);
```

The eventual Prisma model must match that table and its Contract relation. In the controlled installation, prefill all existing Contract IDs once under the installation's exclusive/write-safe boundary, then enable the new-Contract creation trigger; new Contract plus its marker must commit together. Neither payment options nor payment execution creates a missing marker. A missing marker fails closed as an incomplete technical basis.

### Trigger/caller matrix

| Surface | Required action | Lock behavior / immutable evidence |
| --- | --- | --- |
| Contract AFTER INSERT | create its marker revision0 | Same transaction; no deferred/runtime repair |
| Contract deletion | original legitimate deletion may cascade its technical marker | Review existing lifecycle/FKs; do not forbid empty-draft deletion or erase any payment/history fact |
| ContractTakeover INSERT | if NEW joins the confirmed/balance-confirmed basis, lock marker NOWAIT then increment +1 | No waiting marker edge after the writer's row locks |
| ContractTakeover UPDATE | if OLD or NEW belongs to basis and the exact fingerprint tuple changes, bump affected parent markers | Tuple: id, contractId, contractVersionId, paymentTermsVersionId, takeoverStatus, historicalBalanceConfirmedAt, activatedAt, updatedAt, paid/proxy/advance values; stable parent-ID order if two parents |
| ContractTakeover DELETE | if OLD belongs to basis, lock marker NOWAIT then +1 | Same transaction; rollback also rolls back revision |
| Direct marker INSERT/UPDATE/DELETE | forbidden to runtime role | Not a public mutation port; identity/revision strict guard and explicit privileges |
| New registered payment (all sources) | acquire marker FOR UPDATE NOWAIT before settlement/history/account business locks | A holder is never waited on; conflict becomes safe serialization failure, original key retained |
| Payment basis read | read complete confirmed records normally after marker acquisition | No FOR SHARE/UPDATE on historical rows: avoids the new marker-to-historical-row wait cycle |
| Event write/commit guard | verify server revision and full frozen basis against the same transaction | Same-transaction history mutation cannot silently change basis after initial validation |
| Original successful key/result/canonical replay | keep existing receipt-first path | Never consult current marker/basis to invalidate committed old fact |

Each writer's trigger must acquire the SAME marker using the same NOWAIT function before incrementing. Lock-not-available is normalized to a serialization conflict, causing the entire historical/payment transaction to roll back; this is not a fabricated success or automatic retry. The payment function also locks the real marker row, so a marker UPDATE committed after its Serializable snapshot cannot be treated as an unchanged lock-only parent. This latter expected PG behavior is NOT yet executed/proved.

If a historical writer starts first and owns the marker, the payment fails immediately rather than waiting while holding other rows. If the payment owns it first and a historical row writer reaches its trigger, that writer fails immediately and releases its row locks on rollback. Ordinary existing domain lock order remains subject to the real-PG matrix; this proposal only removes the NEW marker wait edge and NEW history-row lock cycle, not a blanket deadlock-free claim.

The server fingerprint MUST include revision, e.g. fixed JSON.stringify({contractId,revision:revision.toString(),records}). The SQL encoder must reproduce that exact order/types plus the existing records encoding and compare the complete structural snapshot. Thus change-and-restore of monetary values cannot alias an old confirmation version. No additional client-authoritative money input is introduced.

### Fixed search path and privilege installation gate

All new database functions must use explicit public-qualified tables/functions and fixed search_path=pg_catalog,public (trusted schema ownership must be verified). Internal marker creation/bump trigger functions are SECURITY DEFINER owned by the migration role, with EXECUTE revoked from PUBLIC and the runtime role; the read/lock API gets only the specific runtime EXECUTE grant. Marker table DML is revoked from runtime/PUBLIC, including default ACL grants, so no client-settable GUC or arbitrary +1 UPDATE can stand in for the trigger. The strict row guard independently allows only stable identity and +1 under the known trigger path; owner/DDL privileges are outside business runtime.

Actual migration/runtime role names and default ACLs are not currently verified and must not be guessed. The future installation must fail closed unless an explicit owner/runtime role separation and exact grants are supplied/reviewed; current application owner credentials are not evidence. A runtime role that can install triggers/disable guards or owns the table would invalidate this privilege claim. This is an explicit pre-promotion gate, not an assumed production fact.

### Additional prepared PG expectations

- READ COMMITTED historical writer owns Takeover/Settlement before reaching marker while payment owns marker: writer must fail without waiting; payment's complete set remains stable, no introduced marker/row deadlock.
- Reverse ordering: payment sees NOWAIT conflict before new financial effects; source query keeps the original key and does not auto-resubmit.
- Writer commits new first confirmed member after payment snapshot but before marker acquisition: stale payment must fail, even though no historical row was initially lockable.
- Existing-row change followed by exact value/date restore still advances revision and invalidates the old expectedFingerprint.
- Same transaction mutates history after constructing Event: deferred current revision/full-basis guard must reject rather than commit stale evidence.
- Direct runtime marker update/insert/delete, direct internal-function execute, missing marker, malformed revision and Contract-create rollback all fail/roll back as specified; actual ACL checks are mandatory.
- Verify original same-key replay after future revision changes remains read-only and returns the original fact; legacy bank and unsupported wage flows are not converted into marker-based new money actions.

All cases remain prepared/unexecuted. No new task34 product flow, active Schema change, client generation, resource, SQL or migration execution is authorized by this plan.
