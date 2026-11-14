# Native timestamp and JSON byte vectors: NOT EXECUTED

Active Schema a779 uses plain Prisma DateTime defaults for ContractTakeover updatedAt/balanceConfirmedAt/activatedAt, ApprovalInstance createdAt and PaymentExecution paidAt. The PostgreSQL provider maps them to timestamp(3) without time zone; the prepared installation asserts these exact installed native types before claiming the reviewed predecessor. No real database metadata has been read to verify that assertion.

The timestamp-without-time-zone formatter prints the stored UTC wall-clock value directly as milliseconds plus Z, matching the Prisma Date read convention. It must NOT apply AT TIME ZONE and then format a timestamptz under the session's zone. The separate timestamptz overload applies AT TIME ZONE 'UTC' before formatting. Current plain DateTime columns choose the former overload; future explicit native-type changes require Schema/predecessor review, not an implicit cast. NULL columns use their real native type and serialize as JSON null. This is encoding, not a correction of historical timestamps or a proof of their original real-world instant.

Future authorized PG vectors must run each row under UTC, Asia/Shanghai, America/New_York and Pacific/Auckland session TimeZone, using separate actual Prisma reads plus SQL bytes:

| Native input | Expected formatter bytes |
| --- | --- |
| timestamp(3) '2026-11-05 16:00:00.123' | 2026-11-05T16:00:00.123Z |
| timestamptz(3) '2026-11-06 00:00:00.123+08' | 2026-11-05T16:00:00.123Z |
| timestamp(3) '2024-02-29 23:59:59.999' | 2024-02-29T23:59:59.999Z |
| timestamptz(3) '2026-11-01 01:30:00.001-04' | 2026-11-01T05:30:00.001Z |
| NULL::timestamp(3), NULL::timestamptz(3) | SQL NULL; enclosing JSON literal null |

Include milliseconds000/999, day/year boundaries, DST offsets, quote/backslash/control-character/Chinese text identifiers, multiple records ordered by the same database id ordering, empty record sets, and server revision changes with identical final records. Independently compute the JS JSON.stringify({contractId,revision:revision.toString(),records}) bytes and SHA256, then compare the actual SQL canonical bytes and digest and the whole structural basis. JSONB display text is not the JS byte encoder. Test that changing session TimeZone alone cannot change the basis fingerprint for the same stored data.

The above are expected vectors, not observed outputs. No SQL function, hash, native-type preflight, ACL, trigger, transaction, PG resource or migration has been executed here.

The SQL formatter fails closed for nonfinite timestamps and years outside the reviewed four-digit CE ISO encoding, rather than producing NULL canonical text and silently dropping a record in string_agg. Add actual Infinity/-Infinity/BC/expanded-year vectors expecting whole command rejection and zero financial effects. No public application date range, Prisma data, or historical timestamp is rewritten here; support outside this reviewed encoding remains an explicit source-review/PG gate, not a claim of tested acceptance.

Scope correction after parent review: the fail-closed finite/four-digit formatter is used only for history/approval metadata encoding. The original paidAt audit comparison keeps its existing plain timestamp(3) formatting, with the exact native-type predecessor assertion; no new paidAt range/validation is introduced. All application business-date adapters and accepted dates remain unchanged. Any reachable legacy metadata date outside the reviewed encoding remains an independent compatibility gate rather than a silent truncation.
