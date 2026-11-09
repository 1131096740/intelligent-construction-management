// Fixed source recipe, not an observation of or permission grant to any role.
export const DIRECT_PENDING_DB_RECIPE = {
  "legacyRetentionReads": {
    "ContractDraftAttachment": [
      "fileId",
      "slotKey"
    ]
  },
  "attachmentLock": {
    "table": "FileObject",
    "mode": "FOR UPDATE NOWAIT",
    "privilege": "UPDATE:any-column",
    "advisoryNamespace": 190731,
    "advisoryKey": 13
  },
  "catalogGuardReads": {
    "pg_catalog.pg_class": [
      "oid",
      "relnamespace",
      "relkind",
      "relrowsecurity",
      "relforcerowsecurity"
    ]
  },
  "catalogGuardFunctions": [
    "pg_catalog.to_regclass(text)",
    "pg_catalog.to_regnamespace(text)"
  ],
  "builtinNames": [
    "jsonb_build_object",
    "jsonb_build_array",
    "jsonb_object_keys",
    "jsonb_array_elements",
    "jsonb_array_elements_text",
    "jsonb_each",
    "jsonb_agg",
    "cardinality",
    "length",
    "replace",
    "count",
    "to_char",
    "make_date",
    "convert_to",
    "encode",
    "format",
    "array_agg",
    "array_to_string",
    "unnest",
    "substring",
    "btrim"
  ],
  "operatorNames": [
    "=",
    "<>",
    ">",
    ">=",
    "<",
    "<=",
    "~",
    "!~",
    "->",
    "->>",
    "#>",
    "#>>",
    "?",
    "?&",
    "||",
    "-"
  ],
  "operatorTypeNames": [
    "jsonb",
    "text",
    "int4",
    "int8",
    "numeric",
    "bool",
    "timestamp",
    "date",
    "oid",
    "bytea",
    "name",
    "_text",
    "_oid"
  ],
  "recipeVersion": "contract-direct-pending-input-v1/1",
  "sourceReads": {
    "Contract": [
      "id",
      "projectId",
      "name",
      "contractTypeKey"
    ],
    "ContractVersion": [
      "id",
      "contractId",
      "versionNo",
      "changeType",
      "numericProtocolVersion",
      "status",
      "signingSubjectType",
      "draftRevision",
      "originalSignedNumber",
      "draftData",
      "amountYuan",
      "amountLimitType",
      "pricingNature",
      "amountSource",
      "invoiceType",
      "taxMode",
      "defaultTaxRatePercent",
      "affiliateAssignmentId",
      "affiliateBusinessPartyVersionId",
      "affiliateNameSnapshot",
      "affiliateCreditCodeSnapshot"
    ],
    "ContractPartySnapshot": [
      "id",
      "contractVersionId",
      "roleKey",
      "displayOrder",
      "businessPartyVersionId",
      "snapshot"
    ],
    "BusinessPartyVersion": [
      "id",
      "businessPartyId",
      "snapshot"
    ],
    "ProjectAffiliateAssignment": [
      "id",
      "projectId",
      "businessPartyId",
      "businessPartyVersionId",
      "affiliateNameSnapshot",
      "affiliateCreditCodeSnapshot",
      "effectiveFrom"
    ],
    "PaymentTermsVersion": [
      "id",
      "contractId",
      "contractVersionId",
      "versionNo",
      "originalText"
    ],
    "PaymentTermsStage": [
      "id",
      "paymentTermsVersionId"
    ],
    "ContractDraftAttachment": [
      "contractVersionId",
      "slotKey",
      "fileId",
      "displayOrder"
    ],
    "FileObject": [
      "id",
      "mimeType",
      "sizeBytes",
      "contentSha256",
      "storageStatus",
      "purgeReceiptId",
      "supersedesFileObjectId"
    ]
  },
  "attachmentReads": {
    "ContractVersion": [
      "id",
      "contractId",
      "numericProtocolVersion",
      "changeType",
      "status",
      "draftData"
    ],
    "Contract": [
      "id",
      "ownerUserId"
    ],
    "FileObject": [
      "id",
      "mimeType",
      "sizeBytes",
      "contentSha256",
      "storageStatus",
      "purgeReceiptId",
      "supersedesFileObjectId",
      "uploadedByUserId"
    ]
  },
  "routines": [
    {
      "signature": "public.jg_contract_direct_pending_binding_guard_v1()",
      "bodySha256": "5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d",
      "securityDefiner": false,
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "language": "plpgsql",
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_contract_direct_pending_version_guard_v1()",
      "bodySha256": "5226ea72ac28bf9af8f7e8a5acff4eb97d0f4aacd8d879fe1c08d3c9cc20b400",
      "securityDefiner": false,
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "language": "plpgsql",
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_contract_direct_pending_input_v1(pg_catalog.text)",
      "bodySha256": "24e586804f996807e6c0d28bc5e1401551fc1c73e92eca93cec4a06c50b1f6e9",
      "securityDefiner": false,
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "language": "plpgsql",
      "returnType": "jsonb",
      "volatility": "s",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_contract_direct_pending_attachment_guard_v1()",
      "bodySha256": "75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1",
      "securityDefiner": false,
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "language": "plpgsql",
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_contract_direct_pending_file_guard_v1()",
      "bodySha256": "106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1",
      "securityDefiner": false,
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "language": "plpgsql",
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_has_exclusive_file_business_binding(pg_catalog.text)",
      "bodySha256": "34c8b2cc5f110c24d67eba3491d580d0f656b6c7bbf1fced769f929b648a8f90",
      "securityDefiner": false,
      "searchPath": null,
      "language": "plpgsql",
      "returnType": "bool",
      "volatility": "s",
      "parallel": "r",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.\"appendOperatingFactThroughService\"(public.\"OperatingLedgerFactWritePayloadV2\",pg_catalog.text,pg_catalog.text)",
      "bodySha256": "aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58",
      "securityDefiner": true,
      "language": "plpgsql",
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "returnType": "record",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.\"appendOperatingImpactThroughService\"(public.\"OperatingLedgerImpactWritePayloadV2\",pg_catalog.text,pg_catalog.text)",
      "bodySha256": "c96af192e9f1711305791ebb8430f5ec888953ba40f675d9bf3c7fc3b1985d33",
      "securityDefiner": true,
      "language": "plpgsql",
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "returnType": "text",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_contract_archive_v2_parent_guard()",
      "bodySha256": "cf2ec4a4f164edf43024c0569e24cd6cd67b191620c6dc6034923d84bc4948b4",
      "securityDefiner": false,
      "language": "plpgsql",
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_file_business_binding_columns()",
      "bodySha256": "d2a3171b76def6792d43f5cc37ede636f0f25e57b4dcf25625d3e4c91471080f",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_affiliate_company_contract()",
      "bodySha256": "3829c2f025c6a293806249e9e6ccdf835b7e41be122dc9933b139dcff79dc7d2",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "i",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_payment_execution()",
      "bodySha256": "fb1c1f94c2cabc5a2269bfda41c5a1cb436d34fcf51525b2819b3e84389722ce",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_project_expense_execution()",
      "bodySha256": "2705ed0ade452177bf09d92be34cb69032b0dc17d6c08fc550c44ec8a3f26a7e",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_project_financing_quota_request()",
      "bodySha256": "4e0c8631b174e41bad8709ea97ca3f3edb01bd77d8d9da4e66d3e6713d14f3da",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_operating_takeover()",
      "bodySha256": "67434ace8ef58c6fb4cb0f223e194e73f6a54c9053a6f02aeab07a2142c2c60f",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_wage_statement()",
      "bodySha256": "221c2ae6614614ede5b9ca73537a3603b1d7e249881564c4078c37c225b851f8",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol13b()",
      "bodySha256": "78f95dab983cbff5c465f2608eaef8ae363a21adedd321a8c8d4bfc74fe84fd3",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol13b_attestation()",
      "bodySha256": "954c64ee3c644672e92b52c116c5756c950e5e21dabe134e6b83b2e925abe66e",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol13b_payer_authority()",
      "bodySha256": "9adca11635cacf6606054cbbf875e0810e19ba5a34a366f9ec801e4113583d96",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol13d_fund_execution()",
      "bodySha256": "1acf8d7063f3f6eeb00c5032c479af062a2f2e654188190f624ad2099f276336",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority()",
      "bodySha256": "77a8609e78c6400c7e2307d77760c71f2fcfeb07ccf4825478cb242964b07dbe",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol260_invoice_evidence_repair()",
      "bodySha256": "d5e0cf16db18893191a279b31b7c13d5ac7e6721f21d5741fc4e5cac5962c79e",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol279_necessary_expense_reserve()",
      "bodySha256": "6dc038aa23a8c8b30fbc81e39d46e63740dfa39786ef41b3714b1808eff391ec",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_pol280_project_fund_dispute()",
      "bodySha256": "fa10ee02640bfcc97289534ce6b1cc6ff525b2c23ad5f5785f9a982b195edf45",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_general_procurement()",
      "bodySha256": "11f8bb70d002a60d9d32e65ed9432d2dabe2e807d0e616e077741acc857b45c0",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_contract_proxy()",
      "bodySha256": "c4cfe12255775d52a074557bde16edf4b567928e2daaa198d1f4126973ecddad",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_upward_amount()",
      "bodySha256": "72346a5ba2490a298affb2a438052098ec90d866ab83e0aba541c1ce1e71f8ce",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_bank_verification()",
      "bodySha256": "84fe2c12bba4a725651e96cae2d8d1fcceb741b633c5b36e8c3b45b7151c00c5",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_company_transfer()",
      "bodySha256": "f7d5ff5cc489348c171760579dc8558eb30cdcf3336a00c15416717bfe531fc3",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_binding_columns_before_contract_archive_v2()",
      "bodySha256": "fb767ff29a7a4e2c3174ac8b97fd306b3ed7946cd1db31cb3fa6f6aba2270af3",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_file_business_collision_columns()",
      "bodySha256": "59bcdff6d8e5026d8619a3fd7cf0d8796091e61f41ea4eb1543c9d1e0b530012",
      "securityDefiner": false,
      "language": "sql",
      "searchPath": null,
      "returnType": "record",
      "volatility": "s",
      "parallel": "s",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.jg_enforce_file_replacement_exclusive_binding()",
      "bodySha256": "4c91d71432a110f0b491bb04da4c1f0a0e5d53d7116f5ef1e4f3e2ca7f839bda",
      "securityDefiner": false,
      "language": "plpgsql",
      "searchPath": null,
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    },
    {
      "signature": "public.jg_enforce_exclusive_file_business_binding()",
      "bodySha256": "e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999",
      "securityDefiner": false,
      "language": "plpgsql",
      "searchPath": null,
      "returnType": "trigger",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": false
    }
  ],
  "triggers": [
    {
      "name": "jg_direct_pending_binding_immutable",
      "table": "jg_contract_direct_pending_binding_v1",
      "function": "public.jg_contract_direct_pending_binding_guard_v1()",
      "type": 31,
      "columns": [],
      "argumentCount": 0,
      "arguments": "",
      "definitions": null
    },
    {
      "name": "jg_direct_pending_version_shape",
      "table": "ContractVersion",
      "function": "public.jg_contract_direct_pending_version_guard_v1()",
      "type": 23,
      "columns": [],
      "argumentCount": 0,
      "arguments": "",
      "definitions": null
    },
    {
      "name": "jg_direct_pending_attachment_source",
      "table": "ContractDraftAttachment",
      "function": "public.jg_contract_direct_pending_attachment_guard_v1()",
      "type": 23,
      "columns": [],
      "argumentCount": 0,
      "arguments": "",
      "definitions": null
    },
    {
      "name": "jg_direct_pending_attachment_exclusive",
      "table": "ContractDraftAttachment",
      "function": "public.jg_enforce_exclusive_file_business_binding()",
      "type": 23,
      "columns": [
        "fileId",
        "slotKey"
      ],
      "argumentCount": 2,
      "arguments": "66696c654964007472756500",
      "definitions": [
        "CREATE TRIGGER jg_direct_pending_attachment_exclusive BEFORE INSERT OR UPDATE OF \"fileId\", \"slotKey\" ON public.\"ContractDraftAttachment\" FOR EACH ROW WHEN ((new.\"slotKey\" = 'direct_signed_originals_v1'::text)) EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true')",
        "CREATE TRIGGER jg_direct_pending_attachment_exclusive BEFORE INSERT OR UPDATE OF \"fileId\", \"slotKey\" ON public.\"ContractDraftAttachment\" FOR EACH ROW WHEN ((new.\"slotKey\" = 'direct_signed_originals_v1'::text)) EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId', 'true')"
      ]
    },
    {
      "name": "jg_direct_pending_file_retained",
      "table": "FileObject",
      "function": "public.jg_contract_direct_pending_file_guard_v1()",
      "type": 27,
      "columns": [],
      "argumentCount": 0,
      "arguments": "",
      "definitions": null
    }
  ],
  "applicationExecSignatures": [
    "public.jg_contract_direct_pending_version_guard_v1()",
    "public.jg_contract_direct_pending_input_v1(pg_catalog.text)",
    "public.jg_contract_direct_pending_attachment_guard_v1()",
    "public.jg_contract_direct_pending_file_guard_v1()",
    "public.jg_has_exclusive_file_business_binding(pg_catalog.text)",
    "public.jg_file_business_binding_columns()",
    "public.jg_file_business_binding_columns_before_affiliate_company_contract()",
    "public.jg_file_business_binding_columns_before_payment_execution()",
    "public.jg_file_business_binding_columns_before_project_expense_execution()",
    "public.jg_file_business_binding_columns_before_project_financing_quota_request()",
    "public.jg_file_business_binding_columns_before_operating_takeover()",
    "public.jg_file_business_binding_columns_before_wage_statement()",
    "public.jg_file_business_binding_columns_before_pol13b()",
    "public.jg_file_business_binding_columns_before_pol13b_attestation()",
    "public.jg_file_business_binding_columns_before_pol13b_payer_authority()",
    "public.jg_file_business_binding_columns_before_pol13d_fund_execution()",
    "public.jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority()",
    "public.jg_file_business_binding_columns_before_pol260_invoice_evidence_repair()",
    "public.jg_file_business_binding_columns_before_pol279_necessary_expense_reserve()",
    "public.jg_file_business_binding_columns_before_pol280_project_fund_dispute()",
    "public.jg_file_business_binding_columns_before_general_procurement()",
    "public.jg_file_business_binding_columns_before_contract_proxy()",
    "public.jg_file_business_binding_columns_before_upward_amount()",
    "public.jg_file_business_binding_columns_before_bank_verification()",
    "public.jg_file_business_binding_columns_before_company_transfer()",
    "public.jg_file_business_binding_columns_before_contract_archive_v2()",
    "public.jg_file_business_collision_columns()",
    "public.jg_enforce_file_replacement_exclusive_binding()",
    "public.jg_enforce_exclusive_file_business_binding()"
  ],
  "fileExecSignatures": [
    "public.jg_contract_direct_pending_file_guard_v1()",
    "public.jg_has_exclusive_file_business_binding(pg_catalog.text)"
  ],
  "allowedSecurityDefiners": [
    {
      "signature": "public.\"appendOperatingFactThroughService\"(public.\"OperatingLedgerFactWritePayloadV2\",pg_catalog.text,pg_catalog.text)",
      "bodySha256": "aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58",
      "securityDefiner": true,
      "language": "plpgsql",
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "returnType": "record",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": true
    },
    {
      "signature": "public.\"appendOperatingImpactThroughService\"(public.\"OperatingLedgerImpactWritePayloadV2\",pg_catalog.text,pg_catalog.text)",
      "bodySha256": "c96af192e9f1711305791ebb8430f5ec888953ba40f675d9bf3c7fc3b1985d33",
      "securityDefiner": true,
      "language": "plpgsql",
      "searchPath": [
        "pg_catalog",
        "public"
      ],
      "returnType": "text",
      "volatility": "v",
      "parallel": "u",
      "strict": false,
      "returnsSet": true
    }
  ],
  "applicationCatalogExecSignatures": [
    "pg_catalog.pg_get_triggerdef(oid,boolean)",
    "pg_catalog.current_schemas(boolean)",
    "pg_catalog.pg_my_temp_schema()",
    "pg_catalog.to_regtype(text)",
    "pg_catalog.current_setting(text)"
  ]
} as const;
