BEGIN;
INSERT INTO "Contract" (id,"projectId",code,name,counterparty,"createdAt","updatedAt","companyEntityId","companyEntityName","contractTypeKey",source)
VALUES ('99999999-0000-4000-8000-000000000001',(SELECT id FROM "Project" ORDER BY code LIMIT 1),'HT-CUT-0001','切换后新增合同','切换演练相对方','2026-11-24 01:00:00','2026-11-24 01:00:00',(SELECT id FROM "CompanyEntity" ORDER BY name LIMIT 1),(SELECT name FROM "CompanyEntity" ORDER BY name LIMIT 1),'construction','system');
INSERT INTO "ContractVersion" (id,"contractId","versionNo","changeType",status,"amountCents","effectiveAt","createdAt","updatedAt","clauseSnapshot","templateSnapshot","draftData","amountLimitType","taxMode","taxFactStatus","taxFactRevision","signingSubjectType","documentContentRevision","numericProtocolVersion","amountYuan")
VALUES ('99999999-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000001',1,'original','draft',123457,NULL,'2026-11-24 01:00:00','2026-11-24 01:00:00','{"seed":true}'::jsonb,'{"seed":true}'::jsonb,'{"seed":true,"cutover":true}'::jsonb,'capped','single_rate','unconfirmed',0,'our_company',1,2,1234.5678);
INSERT INTO "PaymentTermsVersion" (id,"contractId","contractVersionId","versionNo",status,"originalText","createdAt","updatedAt")
VALUES ('99999999-0000-4000-8000-000000000003','99999999-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000002',1,'effective','切换后新增条款','2026-11-24 01:00:00','2026-11-24 01:00:00');
INSERT INTO "Settlement" (id,"projectId","contractId","contractVersionId","paymentTermsVersionId",code,"periodLabel",status,"amountCents","payableAmountCents","paidAmountCents","createdAt","updatedAt","isFinal","sourceType")
VALUES ('99999999-0000-4000-8000-000000000004',(SELECT id FROM "Project" ORDER BY code LIMIT 1),'99999999-0000-4000-8000-000000000001','99999999-0000-4000-8000-000000000002','99999999-0000-4000-8000-000000000003','JS-CUT-0001','切换期','draft',123457,123457,0,'2026-11-24 01:00:00','2026-11-24 01:00:00',false,'settlement');
INSERT INTO "RegisteredFundAccount" (id,"scopeKey",kind,"companyEntityId","createdAt")
VALUES ('99999999-0000-4000-8000-000000000005','company:'||(SELECT id FROM "CompanyEntity" ORDER BY name DESC LIMIT 1),'company',(SELECT id FROM "CompanyEntity" ORDER BY name DESC LIMIT 1),'2026-11-24 01:00:00');
INSERT INTO "AuditLog" (id,"actorUserId",action,"businessType","businessId",metadata,"createdAt")
VALUES ('cutover-audit-0001',(SELECT id FROM "User" ORDER BY id LIMIT 1),'cutover.new_write','contract','99999999-0000-4000-8000-000000000001','{"cutover":true,"phase":"open_write"}'::jsonb,'2026-11-24 01:00:00'),
       ('cutover-audit-0002',(SELECT id FROM "User" ORDER BY id LIMIT 1),'cutover.new_write','settlement','99999999-0000-4000-8000-000000000004','{"cutover":true,"phase":"open_write"}'::jsonb,'2026-11-24 01:00:00');
COMMIT;
