import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const dedicatedParameters = new Set([
  "schema", "connection_limit", "sslmode", "sslaccept", "sslcert",
  "application_name", "connect_timeout", "pool_timeout"
]);

function connection(value: string | undefined) {
  if (!value || /\s/u.test(value)) return;
  try {
    const url = new URL(value);
    const role = decodeURIComponent(url.username);
    const database = decodeURIComponent(url.pathname.slice(1));
    if (url.protocol !== "postgresql:" || !url.hostname || !role || !database || database.includes("/") || url.hash
      || /\p{Cc}/u.test(role + database)) return;
    return { value, url, role, database };
  } catch {
    return;
  }
}

function dedicatedConnection(value: string | undefined) {
  const target = connection(value);
  if (!target) return;
  const { url } = target;
  const parameters = [...url.searchParams.keys()];
  if (!url.password || new Set(parameters).size !== parameters.length
    || parameters.some(parameter => !dedicatedParameters.has(parameter))
    || (url.searchParams.get("schema") ?? "public") !== "public"
    || url.searchParams.get("connection_limit") !== "1"
    || url.searchParams.get("sslmode") !== "require"
    || url.searchParams.get("sslaccept") !== "strict"
    || !url.searchParams.get("sslcert")?.trim()) return;
  return target;
}

@Injectable()
export class ContractDirectArchiveRuntime implements OnApplicationShutdown {
  readonly issuer?: PrismaClient;
  readonly executor?: PrismaClient;

  constructor() {
    const ordinary = connection(process.env.DATABASE_URL);
    const issuer = dedicatedConnection(process.env.DIRECT_ARCHIVE_ISSUER_DATABASE_URL);
    const executor = dedicatedConnection(process.env.DIRECT_ARCHIVE_RUNTIME_DATABASE_URL);
    if (!ordinary || !issuer || !executor || new Set([ordinary.role, issuer.role, executor.role]).size !== 3
      || [issuer, executor].some(target => target.database !== ordinary.database
        || target.url.hostname !== ordinary.url.hostname
        || (target.url.port || "5432") !== (ordinary.url.port || "5432"))) return;

    // These clients connect lazily when the qualified route invokes each transport.
    this.issuer = new PrismaClient({ datasources: { db: { url: issuer.value } } });
    this.executor = new PrismaClient({ datasources: { db: { url: executor.value } } });
  }

  async onApplicationShutdown() {
    await Promise.all([...new Set([this.issuer, this.executor])].map(client => client?.$disconnect()));
  }
}
