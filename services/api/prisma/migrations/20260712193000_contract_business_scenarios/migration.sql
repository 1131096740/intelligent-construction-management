ALTER TABLE "Contract"
  ADD COLUMN "businessScenarioId" TEXT,
  ADD COLUMN "scenarioTemplateMappingId" TEXT,
  ADD COLUMN "scenarioSnapshot" JSONB;

CREATE TABLE "ContractBusinessScenario" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractBusinessScenario_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractBusinessScenario_revision_check" CHECK ("revision" > 0)
);

CREATE UNIQUE INDEX "ContractBusinessScenario_code_key"
  ON "ContractBusinessScenario"("code");

CREATE TABLE "ContractScenarioTemplateMapping" (
  "id" TEXT NOT NULL,
  "businessScenarioId" TEXT NOT NULL,
  "contractTypeKey" TEXT NOT NULL,
  "businessTemplateVersionId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractScenarioTemplateMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractScenarioTemplateMapping_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ContractScenarioTemplateMapping_priority_check" CHECK ("priority" BETWEEN 0 AND 1000000)
);

CREATE UNIQUE INDEX "ContractScenarioTemplateMapping_exact_key"
  ON "ContractScenarioTemplateMapping"(
    "businessScenarioId", "businessTemplateVersionId"
  );
CREATE INDEX "ContractScenarioTemplateMapping_lookup_idx"
  ON "ContractScenarioTemplateMapping"("businessScenarioId", "contractTypeKey", "active");

ALTER TABLE "ContractScenarioTemplateMapping"
  ADD CONSTRAINT "ContractScenarioTemplateMapping_scenario_fk"
  FOREIGN KEY ("businessScenarioId") REFERENCES "ContractBusinessScenario"("id"),
  ADD CONSTRAINT "ContractScenarioTemplateMapping_template_version_fk"
  FOREIGN KEY ("businessTemplateVersionId") REFERENCES "ContractBusinessTemplateVersion"("id");
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_business_scenario_fk"
  FOREIGN KEY ("businessScenarioId") REFERENCES "ContractBusinessScenario"("id"),
  ADD CONSTRAINT "Contract_scenario_mapping_fk"
  FOREIGN KEY ("scenarioTemplateMappingId") REFERENCES "ContractScenarioTemplateMapping"("id");

CREATE INDEX "Contract_businessScenarioId_idx" ON "Contract"("businessScenarioId");
CREATE INDEX "Contract_scenarioTemplateMappingId_idx" ON "Contract"("scenarioTemplateMappingId");

-- No scenario or mapping seed is created by this migration. Governance starts empty.
