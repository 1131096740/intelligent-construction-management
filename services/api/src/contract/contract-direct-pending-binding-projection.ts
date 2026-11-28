import { Prisma } from "@prisma/client";

// The predecessor digest is over exactly these native PostgreSQL types.
// Bind the fixed physical relation and refuse an inherited or partitioned
// source before using ONLY. An inherited child must never be hidden.
export const directPendingBindingOid = Prisma.sql`
  pg_catalog.to_regclass('public.jg_contract_direct_pending_binding_v1')::oid
`;

export const directPendingBindingProjection = Prisma.sql`
  (SELECT src."protocolVersion",src."recipeVersion",src."applicationRoleOid",src."fileCallerOids",
          src."databaseOid",src."anchorNamespaceOid",src."anchorOwnerOid",src."bindings"
     FROM ONLY public.jg_contract_direct_pending_binding_v1 src
     JOIN pg_catalog.pg_class base ON base.oid=${directPendingBindingOid}
       AND base.relnamespace=pg_catalog.to_regnamespace('public')
       AND base.relnamespace=src."anchorNamespaceOid" AND base.relowner=src."anchorOwnerOid"
       AND base.relkind='r' AND base.relpersistence='p' AND NOT base.relispartition
       AND NOT base.relrowsecurity AND NOT base.relforcerowsecurity
     JOIN pg_catalog.pg_database db ON db.datname=pg_catalog.current_database()
       AND db.oid=src."databaseOid" AND db.datdba=base.relowner
     WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_inherits i WHERE i.inhrelid=base.oid OR i.inhparent=base.oid))
`;
