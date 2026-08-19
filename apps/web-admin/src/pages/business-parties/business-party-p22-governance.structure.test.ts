import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FROZEN_TEST_ONLY_WRAPPERS = [
  "createCompanyEntity",
  "updateCompanyEntity",
  "applyOrganizationRoleAddition",
  "applyOrganizationRoleRemoval",
  "createOrganizationUser",
  "previewOrganizationRoleAddition",
  "previewOrganizationRoleRemoval"
] as const;

type FrozenTestOnlyWrapper = (typeof FROZEN_TEST_ONLY_WRAPPERS)[number];

type RetirementManifestEntry = {
  apiFile: string;
  classification: "test_only" | "unreachable_only" | "unreferenced";
  wrappers: string[];
};

type RetirementManifest = {
  entries: RetirementManifestEntry[];
};

type WebApiWrapper = {
  name: string;
  productionConsumers: string[];
  testConsumers: string[];
  unreachableConsumers: string[];
};

type WebApiManifest = {
  wrappers: WebApiWrapper[];
};

const EXPECTED_API_FILES: Record<FrozenTestOnlyWrapper, string> = {
  createCompanyEntity: "apps/web-admin/src/api/company-entity.api.ts",
  updateCompanyEntity: "apps/web-admin/src/api/company-entity.api.ts",
  applyOrganizationRoleAddition: "apps/web-admin/src/api/organization.api.ts",
  applyOrganizationRoleRemoval: "apps/web-admin/src/api/organization.api.ts",
  createOrganizationUser: "apps/web-admin/src/api/organization.api.ts",
  previewOrganizationRoleAddition: "apps/web-admin/src/api/organization.api.ts",
  previewOrganizationRoleRemoval: "apps/web-admin/src/api/organization.api.ts"
};

const EXPECTED_UNREACHABLE_CONSUMERS: Record<FrozenTestOnlyWrapper, string> = {
  createCompanyEntity:
    "apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue",
  updateCompanyEntity:
    "apps/web-admin/src/pages/company-entities/components/CompanyEntityFormDrawer.vue",
  applyOrganizationRoleAddition:
    "apps/web-admin/src/pages/organization/components/OrganizationRoleAdditionDrawer.vue",
  applyOrganizationRoleRemoval:
    "apps/web-admin/src/pages/organization/components/OrganizationRoleRemovalDrawer.vue",
  createOrganizationUser:
    "apps/web-admin/src/pages/organization/components/OrganizationUserCreationDrawer.vue",
  previewOrganizationRoleAddition:
    "apps/web-admin/src/pages/organization/components/OrganizationRoleAdditionDrawer.vue",
  previewOrganizationRoleRemoval:
    "apps/web-admin/src/pages/organization/components/OrganizationRoleRemovalDrawer.vue"
};

const EXPECTED_TEST_CONSUMERS: Record<FrozenTestOnlyWrapper, string> = {
  createCompanyEntity: "apps/web-admin/src/api/company-entity.api.test.ts",
  updateCompanyEntity: "apps/web-admin/src/api/company-entity.api.test.ts",
  applyOrganizationRoleAddition: "apps/web-admin/src/api/organization.api.test.ts",
  applyOrganizationRoleRemoval: "apps/web-admin/src/api/organization.api.test.ts",
  createOrganizationUser: "apps/web-admin/src/api/organization.api.test.ts",
  previewOrganizationRoleAddition: "apps/web-admin/src/api/organization.api.test.ts",
  previewOrganizationRoleRemoval: "apps/web-admin/src/api/organization.api.test.ts"
};

const retirementManifest = readJson<RetirementManifest>(
  "docs/product/manifests/retired-web-api-wrappers.json"
);
const webApiManifest = readJson<WebApiManifest>("docs/product/manifests/web-api-wrappers.json");

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../../../../../", relativePath), "utf8")
  ) as T;
}

function findWebApiWrapper(name: string): WebApiWrapper | undefined {
  return webApiManifest.wrappers.find((wrapper) => wrapper.name === name);
}

describe("POL-19A P22 retirement governance", () => {
  it("keeps the seven frozen wrappers test-only in the repository-root registry", () => {
    for (const wrapperName of FROZEN_TEST_ONLY_WRAPPERS) {
      const entry = retirementManifest.entries.find((candidate: { wrappers: string[] }) =>
        candidate.wrappers.includes(wrapperName)
      );

      expect(entry).toMatchObject({
        apiFile: EXPECTED_API_FILES[wrapperName],
        classification: "test_only"
      });
    }
  });

  it("does not promote detached drawers or internal test calls to production consumers", () => {
    for (const wrapperName of FROZEN_TEST_ONLY_WRAPPERS) {
      const wrapper = findWebApiWrapper(wrapperName);

      expect(wrapper).toBeDefined();
      expect(wrapper?.productionConsumers).toEqual([]);
      expect(wrapper?.testConsumers).toContain(EXPECTED_TEST_CONSUMERS[wrapperName]);
      expect(wrapper?.unreachableConsumers).toContain(
        EXPECTED_UNREACHABLE_CONSUMERS[wrapperName]
      );
    }
  });

  it("keeps the real business-party read chain classified as production", () => {
    expect(findWebApiWrapper("listBusinessParties")?.productionConsumers).toContain(
      "apps/web-admin/src/pages/business-parties/BusinessPartyListPage.vue"
    );
    expect(findWebApiWrapper("getBusinessParty")?.productionConsumers).toContain(
      "apps/web-admin/src/pages/business-parties/BusinessPartyEditorPage.vue"
    );
  });
});
