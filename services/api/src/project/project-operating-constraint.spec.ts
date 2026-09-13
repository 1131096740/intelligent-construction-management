import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
  isPostgresSerializationFailure,
  translateOperatingProfileConstraint
} from "./project-operating-constraint";

describe("project operating serialization constraints", () => {
  it.each([
    new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "40001", database_error: "SQLSTATE 40001" }
    }),
    { code: "40001", message: "could not serialize access due to concurrent update" }
  ])("recognizes PostgreSQL serialization failures without retrying", (error) => {
    expect(isPostgresSerializationFailure(error)).toBe(true);
  });

  it("does not classify a deadlock as a serialization failure", () => {
    expect(isPostgresSerializationFailure({ code: "40P01" })).toBe(false);
  });

  it("does not guess whether an ambiguous Prisma P2034 was a write conflict or deadlock", () => {
    expect(isPostgresSerializationFailure(
      new Prisma.PrismaClientKnownRequestError("Transaction failed", {
        code: "P2034",
        clientVersion: "5.22.0"
      })
    )).toBe(false);
  });

  it("maps an opted-in participant mutation serialization failure to HTTP 409", async () => {
    const operation = Promise.reject(new Prisma.PrismaClientKnownRequestError(
      "Raw query failed",
      {
        code: "P2010",
        clientVersion: "5.22.0",
        meta: { code: "40001", database_error: "SQLSTATE 40001" }
      }
    ));

    await expect(translateOperatingProfileConstraint(operation, {
      mapSerializationConflict: true
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it("does not broaden serialization mapping to unrelated profile operations", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "5.22.0",
      meta: { code: "40001", database_error: "SQLSTATE 40001" }
    });

    await expect(translateOperatingProfileConstraint(Promise.reject(error))).rejects.toBe(error);
  });
});
