#!/usr/bin/env node
"use strict";

const { readFileSync, statSync } = require("node:fs");
const { Prisma } = require("@prisma/client");

const MAX_FIXTURE_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;
const HUNDRED = new Prisma.Decimal(100);
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const SHA256 = /^[a-f0-9]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const CENTS = /^(0|[1-9]\d*)$/;
const FORMULA_TYPES = new Set(["none", "formula", "shared_formula", "array_formula"]);

class FixtureError extends Error {
  constructor(code, rowNumber) {
    super(code);
    this.code = code;
    this.rowNumber = rowNumber;
  }
}

function assertPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  return value;
}

function assertExactKeys(value, keys) {
  const expected = new Set(keys);
  if (
    Object.keys(value).some((key) => !expected.has(key)) ||
    keys.some((key) => !(key in value))
  ) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
}

function decimalText(value, code = "FIXTURE_SCHEMA_INVALID") {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FixtureError(code);
    text = new Prisma.Decimal(value.toString()).toString();
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw new FixtureError(code);
  }
  if (!DECIMAL.test(text)) throw new FixtureError(code);
  return text;
}

function normalizeTaxRatePercent(value) {
  let text = decimalText(value);
  const fraction = DECIMAL.exec(text)?.[1] ?? "";
  if (fraction.length > 6) throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  const decimal = new Prisma.Decimal(text);
  if (decimal.gt(100)) throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  return decimal.toString();
}

function parseCell(value) {
  const cell = assertPlainObject(value);
  assertExactKeys(cell, ["value", "numFmt", "formulaType"]);
  if (typeof cell.numFmt !== "string" || cell.numFmt.length > 200) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  if (!FORMULA_TYPES.has(cell.formulaType)) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  return cell;
}

function taxRateFromCell(cell, defaultTaxRatePercent, taxMode, rowNumber) {
  if (cell.formulaType !== "none") {
    throw new FixtureError("FORMULA_TAX_RATE_REQUIRES_REVIEW", rowNumber);
  }
  if (cell.value === null || cell.value === "") return defaultTaxRatePercent;

  let raw = cell.value;
  if (typeof raw === "string" && raw.trim().endsWith("%")) {
    raw = raw.trim().slice(0, -1);
  } else if (typeof raw === "number" && /%/u.test(cell.numFmt)) {
    raw = new Prisma.Decimal(raw.toString()).mul(100).toString();
  }
  const normalized = normalizeTaxRatePercent(raw);
  if (taxMode === "single_rate" && normalized !== defaultTaxRatePercent) {
    throw new FixtureError("SINGLE_RATE_CELL_MISMATCH", rowNumber);
  }
  return normalized;
}

function roundCents(value) {
  const cents = BigInt(
    value.mul(HUNDRED).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed(0)
  );
  if (cents < 0n || cents > POSTGRES_BIGINT_MAX) {
    throw new FixtureError("FIXTURE_AMOUNT_OUT_OF_RANGE");
  }
  return cents;
}

function calculateRow(quantityText, unitPriceText, taxRatePercent) {
  const quantity = new Prisma.Decimal(quantityText);
  const unitPrice = new Prisma.Decimal(unitPriceText);
  if (quantity.lte(0) || unitPrice.isNeg()) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  const inclusive = roundCents(quantity.mul(unitPrice));
  const exclusive = BigInt(
    new Prisma.Decimal(inclusive.toString())
      .div(new Prisma.Decimal(taxRatePercent).div(HUNDRED).add(1))
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(0)
  );
  const tax = inclusive - exclusive;
  const taxExclusiveUnitPrice = new Prisma.Decimal(exclusive.toString())
    .div(HUNDRED)
    .div(quantity)
    .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP)
    .toFixed(6);
  return {
    taxInclusiveAmountCents: inclusive,
    taxExclusiveAmountCents: exclusive,
    taxAmountCents: tax,
    taxExclusiveUnitPrice
  };
}

function centsText(value) {
  if (typeof value !== "string" || !CENTS.test(value)) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  const cents = BigInt(value);
  if (cents > POSTGRES_BIGINT_MAX) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  return value;
}

function inspectFixture(fixture) {
  const root = assertPlainObject(fixture);
  assertExactKeys(root, [
    "sourceSha256",
    "sourceSheetName",
    "taxMode",
    "defaultTaxRatePercent",
    "rows",
    "expected"
  ]);
  if (
    typeof root.sourceSha256 !== "string" ||
    !SHA256.test(root.sourceSha256) ||
    /^0{64}$/u.test(root.sourceSha256)
  ) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  if (
    typeof root.sourceSheetName !== "string" ||
    !root.sourceSheetName.trim() ||
    root.sourceSheetName.length > 200
  ) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  if (!["single_rate", "multiple_rate"].includes(root.taxMode)) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  const defaultTaxRatePercent = normalizeTaxRatePercent(
    root.defaultTaxRatePercent
  );
  if (
    !Array.isArray(root.rows) ||
    root.rows.length === 0 ||
    root.rows.length > MAX_ROWS
  ) {
    throw new FixtureError("FIXTURE_SCHEMA_INVALID");
  }
  const expected = assertPlainObject(root.expected);
  assertExactKeys(expected, [
    "taxInclusiveAmountCents",
    "taxExclusiveAmountCents"
  ]);
  const normalizedExpected = {
    taxInclusiveAmountCents: centsText(expected.taxInclusiveAmountCents),
    taxExclusiveAmountCents: centsText(expected.taxExclusiveAmountCents)
  };

  let inclusiveTotal = 0n;
  let exclusiveTotal = 0n;
  let taxTotal = 0n;
  const rows = root.rows.map((value, index) => {
    const rowNumber = index + 1;
    const row = assertPlainObject(value);
    assertExactKeys(row, [
      "quantityCell",
      "grossUnitPriceCell",
      "taxRateCell"
    ]);
    const quantityCell = parseCell(row.quantityCell);
    const grossUnitPriceCell = parseCell(row.grossUnitPriceCell);
    const taxRateCell = parseCell(row.taxRateCell);
    const quantity = decimalText(quantityCell.value);
    const grossUnitPrice = decimalText(grossUnitPriceCell.value);
    const normalizedTaxRatePercent = taxRateFromCell(
      taxRateCell,
      defaultTaxRatePercent,
      root.taxMode,
      rowNumber
    );
    const calculated = calculateRow(
      quantity,
      grossUnitPrice,
      normalizedTaxRatePercent
    );
    inclusiveTotal += calculated.taxInclusiveAmountCents;
    exclusiveTotal += calculated.taxExclusiveAmountCents;
    taxTotal += calculated.taxAmountCents;
    return {
      rowNumber,
      quantityFormulaType: quantityCell.formulaType,
      grossUnitPriceFormulaType: grossUnitPriceCell.formulaType,
      taxRateFormulaType: taxRateCell.formulaType,
      normalizedTaxRatePercent,
      taxInclusiveAmountCents:
        calculated.taxInclusiveAmountCents.toString(),
      taxExclusiveAmountCents:
        calculated.taxExclusiveAmountCents.toString(),
      taxAmountCents: calculated.taxAmountCents.toString(),
      taxExclusiveUnitPrice: calculated.taxExclusiveUnitPrice
    };
  });
  const totals = {
    taxInclusiveAmountCents: inclusiveTotal.toString(),
    taxExclusiveAmountCents: exclusiveTotal.toString(),
    taxAmountCents: taxTotal.toString()
  };
  const status =
    totals.taxInclusiveAmountCents ===
      normalizedExpected.taxInclusiveAmountCents &&
    totals.taxExclusiveAmountCents ===
      normalizedExpected.taxExclusiveAmountCents
      ? "matched"
      : "mismatch";
  return {
    status,
    sourceSha256: root.sourceSha256,
    sourceSheetName: root.sourceSheetName.trim(),
    taxMode: root.taxMode,
    defaultTaxRatePercent,
    rows,
    totals,
    expected: normalizedExpected
  };
}

function writeResult(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exitCode = exitCode;
}

function main(argv) {
  const fixtureFlag = argv.indexOf("--fixture");
  if (
    fixtureFlag === -1 ||
    fixtureFlag + 1 >= argv.length ||
    argv.length !== 2
  ) {
    writeResult({ status: "blocked", code: "FIXTURE_ARGUMENT_REQUIRED" }, 2);
    return;
  }
  try {
    const fixturePath = argv[fixtureFlag + 1];
    if (statSync(fixturePath).size > MAX_FIXTURE_BYTES) {
      throw new FixtureError("FIXTURE_TOO_LARGE");
    }
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    const result = inspectFixture(fixture);
    writeResult(result, result.status === "matched" ? 0 : 1);
  } catch (error) {
    if (error instanceof FixtureError) {
      writeResult({
        status: "blocked",
        code: error.code,
        ...(error.rowNumber ? { rowNumber: error.rowNumber } : {})
      }, 2);
      return;
    }
    writeResult({ status: "blocked", code: "FIXTURE_READ_FAILED" }, 2);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { inspectFixture };
