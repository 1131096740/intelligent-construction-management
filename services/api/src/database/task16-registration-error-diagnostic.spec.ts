import "reflect-metadata";
import { Controller, Module, Post } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { Server } from "node:http";
import { Task16RegistrationErrorFilter, armTask16RegistrationError, takeTask16RegistrationError, projectTask16RegistrationError } from "./task16-registration-error-diagnostic";

const paymentId = "10000000-0000-4000-8000-000000000001";
const key = "20000000-0000-4000-8000-000000000001";
const different = "30000000-0000-4000-8000-000000000001";
@Controller("payment-executions")
class TechnicalDiagnosticController {
  @Post(":paymentId/registrations")
  record() {
    throw new Prisma.PrismaClientKnownRequestError("fixture secret must not escape", {
      code: "P2010", clientVersion: "fixture", meta: { code: "42501", other: "private fixture" }
    });
  }
}
@Module({ controllers: [TechnicalDiagnosticController], providers: [Task16RegistrationErrorFilter, { provide: APP_FILTER, useExisting: Task16RegistrationErrorFilter }] })
class TechnicalDiagnosticModule {}

describe("Task16 private registration error diagnostic (technical HTTP, no business admission)", () => {
  test("actual Nest request captures only finite codes while original public 500 remains unchanged", async () => {
    const app = await NestFactory.create(TechnicalDiagnosticModule, { logger: false });
    const filter = app.get(Task16RegistrationErrorFilter);
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as Server;
    try {
      const ticket = armTask16RegistrationError(filter, server, paymentId, key);
      const response = await fetch(`${await app.getUrl()}/payment-executions/${paymentId}/registrations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: key })
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ statusCode: 500, message: "Internal server error" });
      expect(takeTask16RegistrationError(filter, server, ticket)).toEqual({ serverErrorKind: "KNOWN_REQUEST_ERROR", serverPrismaCode: "P2010", serverSqlState: "42501" });
      expect(() => takeTask16RegistrationError(filter, server, ticket)).toThrow("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
    } finally { await app.close(); }
  });
  test("untrusted arm input cannot invoke coercion, and forged filters cannot issue tickets", async () => {
    const app = await NestFactory.create(TechnicalDiagnosticModule, { logger: false });
    const filter = app.get(Task16RegistrationErrorFilter);
    await app.listen(0, "127.0.0.1");
    let calls = 0;
    const hostile = { toString() { calls++; return paymentId; } } as unknown as string;
    try {
      expect(() => armTask16RegistrationError(filter, app.getHttpServer(), hostile, key)).toThrow("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
      expect(calls).toBe(0);
      expect(() => armTask16RegistrationError(Object.create(Task16RegistrationErrorFilter.prototype), app.getHttpServer(), paymentId, key)).toThrow("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
    } finally { await app.close(); }
  });
  test("wrong actual request, server, and copied or proxied tickets cannot disclose a capture", async () => {
    const app = await NestFactory.create(TechnicalDiagnosticModule, { logger: false });
    const filter = app.get(Task16RegistrationErrorFilter);
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer() as Server;
    try {
      for (const [id, requestKey] of [[different, key], [paymentId, different]]) {
        const ticket = armTask16RegistrationError(filter, server, paymentId, key);
        const response = await fetch(`${await app.getUrl()}/payment-executions/${id}/registrations`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: requestKey })
        });
        expect(response.status).toBe(500);
        expect(takeTask16RegistrationError(filter, server, ticket)).toBeUndefined();
      }
      const ticket = armTask16RegistrationError(filter, server, paymentId, key);
      for (const forged of [{ ...ticket }, new Proxy(ticket, {})])
        expect(() => takeTask16RegistrationError(filter, server, forged)).toThrow("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
      expect(() => takeTask16RegistrationError(filter, new Server(), ticket)).toThrow("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
      expect(() => takeTask16RegistrationError(filter, server, ticket)).toThrow("TASK16_PRIVATE_REGISTRATION_DIAGNOSTIC");
    } finally { await app.close(); }
  });
  test("same filter on a different actual server cannot bind another server's request", async () => {
    const app = await NestFactory.create(TechnicalDiagnosticModule, { logger: false });
    const other = await NestFactory.create(TechnicalDiagnosticModule, { logger: false });
    const filter = app.get(Task16RegistrationErrorFilter);
    // Sharing a filter in this technical counterfactual must not share its ticket.
    other.useGlobalFilters(filter);
    await app.listen(0, "127.0.0.1");
    await other.listen(0, "127.0.0.1");
    try {
      const ticket = armTask16RegistrationError(filter, app.getHttpServer(), paymentId, key);
      const response = await fetch(`${await other.getUrl()}/payment-executions/${paymentId}/registrations`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: key })
      });
      expect(response.status).toBe(500);
      expect(takeTask16RegistrationError(filter, app.getHttpServer(), ticket)).toBeUndefined();
    } finally { await other.close(); await app.close(); }
  });
  test("native projection never invokes accessors or proxy traps or returns unknown codes", () => {
    let calls = 0;
    const error = new Prisma.PrismaClientKnownRequestError("private", { code: "P2010", clientVersion: "fixture" });
    Object.defineProperty(error, "meta", { get() { calls++; throw new Error("private"); } });
    expect(projectTask16RegistrationError(error)).toEqual({ serverErrorKind: "KNOWN_REQUEST_ERROR", serverPrismaCode: "P2010" });
    const proxy = new Proxy(error, { get() { calls++; throw new Error("private"); } });
    expect(projectTask16RegistrationError(proxy)).toEqual({ serverErrorKind: "UNINSPECTED" });
    expect(projectTask16RegistrationError({ code: "P2010" })).toEqual({ serverErrorKind: "NON_NATIVE_THROWN" });
    const unknown = new Prisma.PrismaClientKnownRequestError("private", { code: "P9999", clientVersion: "fixture", meta: { code: "private" } });
    expect(projectTask16RegistrationError(unknown)).toEqual({ serverErrorKind: "KNOWN_REQUEST_ERROR" });
    expect(calls).toBe(0);
  });
});
