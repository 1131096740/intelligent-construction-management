import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("POL-07 invoice reference migration", () => {
  it("keeps invoice evidence non-economic at the database boundary", () => {
    const sql = readFileSync(
      resolve(
        __dirname,
        "../../prisma/migrations/20260815170000_pol07_spot_procurement_operating_sources/migration.sql"
      ),
      "utf8"
    );

    expect(sql).toContain("'invoice_reference'");
    expect(sql).toContain(
      '"OperatingImpactEntry_invoice_reference_direction_check"'
    );
    expect(sql).toContain(
      '"impactKind" <> \'invoice_reference\' OR "direction" = \'notice\''
    );
  });
});
