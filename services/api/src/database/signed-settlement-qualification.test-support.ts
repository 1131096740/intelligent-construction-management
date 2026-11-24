import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createRequire } from "node:module";
import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

const { createSignedSettlementQualification } = createRequire(__filename)("../../prisma/signed-settlement-qualification.cjs") as {
  createSignedSettlementQualification(databaseUrl: string, options: { existingReadWitness: boolean }): {
    role: string;
    databaseUrl: string;
    writeKey: string;
    ownedReadKey?: string;
    install: string[];
    uninstall: string[];
  }
};

/** Use the live HTTP controllers on a non-owner PG session so the same witness checks as Line A run. */
export async function openSignedSettlementQualification(owner: PrismaService, databaseUrl: string) {
  const previousWriteKey = process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
  const previousReadKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
  const { role, databaseUrl: runtimeUrl, writeKey, ownedReadKey, install, uninstall } = createSignedSettlementQualification(databaseUrl, {
    existingReadWitness: previousReadKey !== undefined
  });
  const safeFailure = (stage: string, cause: unknown) => {
    const error = cause as { errorCode?: string; code?: string; meta?: { code?: string } };
    const code = error?.meta?.code ?? error?.errorCode ?? error?.code ?? "";
    const marker = /^(?:[0-9A-Z]{5}|EADDRINUSE|EACCES|ECONNREFUSED)$/u.test(code) ? code : "UNCLASSIFIED";
    return new Error(`POL114_SIGNED_SETTLEMENT_${stage}_${marker}`);
  };
  try {
    await owner.$transaction(install.map(sql => owner.$executeRawUnsafe(sql)));
  } catch (error) {
    throw safeFailure("PROVISION", error);
  }
  process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = writeKey;
  if (ownedReadKey) process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = ownedReadKey;
  const runtime = new PrismaService({ datasourceUrl: runtimeUrl });
  let app: INestApplication | undefined;
  async function close() {
    if (previousWriteKey === undefined) delete process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
    else process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = previousWriteKey;
    if (ownedReadKey) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    try {
      if (app) await app.close();
      else await runtime.$disconnect();
    } finally {
      await owner.$transaction(uninstall.map(sql => owner.$executeRawUnsafe(sql)));
    }
  }
  let stage = "SESSION";
  try {
    const [session] = await runtime.$queryRaw<Array<{restricted: boolean}>>`
      SELECT session_user = ${role} AND current_user = session_user
        AND NOT has_schema_privilege(session_user, 'public', 'CREATE')
        AND NOT has_table_privilege(session_user, 'public.jg_signed_settlement_draft_witness_key', 'SELECT') AS restricted
    `;
    if (!session?.restricted) {
      stage = "SESSION_PRIVILEGES";
      throw new Error("已签结算验收会话权限超出范围");
    }
    stage = "BOOT";
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(runtime).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    return { baseUrl: await app.getUrl(), close };
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw safeFailure("CLEANUP", cleanupError); }
    throw safeFailure(stage, error);
  }
}
