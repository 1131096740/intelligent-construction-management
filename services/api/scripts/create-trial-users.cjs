const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const ROLE_NAMES = {
  chairman: "董事长",
  contract_director: "合同部主管",
  contract_staff: "合同部成员",
  finance_director: "财务部主管",
  finance_staff: "财务部成员/出纳",
  material_director: "材料部主管",
  project_manager: "项目经理",
  comprehensive_director: "综合部主管"
};

const TRIAL_USERS = [
  { id: "trial-user-contract-staff-1", name: "试运行合同员一", phone: "13900002001", positionKey: "contract_staff" },
  { id: "trial-user-contract-staff-2", name: "试运行合同员二", phone: "13900002002", positionKey: "contract_staff" },
  { id: "trial-user-contract-director", name: "试运行合同主管", phone: "13900002003", positionKey: "contract_director" },
  { id: "trial-user-chairman", name: "试运行老板", phone: "13900002004", positionKey: "chairman" },
  { id: "trial-user-material-director", name: "试运行物资主管", phone: "13900002005", positionKey: "material_director" },
  { id: "trial-user-finance-director", name: "试运行财务总监", phone: "13900002006", positionKey: "finance_director" },
  { id: "trial-user-project-manager", name: "试运行项目经理", phone: "13900002007", positionKey: "project_manager" },
  {
    id: "trial-user-comprehensive-director",
    name: "试运行综合部主管",
    phone: "13900002008",
    positionKey: "comprehensive_director"
  },
  { id: "trial-user-finance-staff-1", name: "试运行财务一", phone: "13900002009", positionKey: "finance_staff" },
  { id: "trial-user-finance-staff-2", name: "试运行财务二", phone: "13900002010", positionKey: "finance_staff" }
];

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((values, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return values;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return values;
      const key = trimmed.slice(0, eq).trim();
      const raw = trimmed.slice(eq + 1).trim();
      values[key] = raw.replace(/^['"]|['"]$/g, "");
      return values;
    }, {});
}

function temporaryPassword() {
  return `Jgzg-${crypto.randomBytes(9).toString("base64url")}1`;
}

async function ensurePosition(prisma, positionKey) {
  const name = ROLE_NAMES[positionKey];
  if (!name) throw new Error(`Unsupported position: ${positionKey}`);
  return prisma.position.upsert({
    where: { key: positionKey },
    update: { name },
    create: { key: positionKey, name }
  });
}

async function upsertTrialUser(prisma, user, projectId, passwordHash) {
  const position = await ensurePosition(prisma, user.positionKey);
  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      name: user.name,
      phone: user.phone,
      passwordHash,
      mustChangePassword: true,
      isActive: true
    },
    create: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      passwordHash,
      mustChangePassword: true,
      isActive: true
    }
  });
  await prisma.userPosition.deleteMany({
    where: { userId: user.id, positionId: position.id, projectId: null }
  });
  await prisma.userPosition.create({
    data: { userId: user.id, positionId: position.id, projectId: null }
  });
  await prisma.projectMember.upsert({
    where: {
      projectId_userId_positionKey: {
        projectId,
        userId: user.id,
        positionKey: user.positionKey
      }
    },
    update: {},
    create: { projectId, userId: user.id, positionKey: user.positionKey }
  });
}

async function main() {
  const env = {
    ...readEnvFile(path.resolve(__dirname, "..", ".env")),
    ...process.env
  };
  if (!process.env.DATABASE_URL && env.DATABASE_URL) {
    process.env.DATABASE_URL = env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const projectId = env.TRIAL_PROJECT_ID || "seed-project-jgxm-001";
  const password = env.TRIAL_USER_TEMP_PASSWORD || temporaryPassword();
  const prisma = new PrismaClient();
  try {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const passwordHash = await bcrypt.hash(password, 10);
    for (const user of TRIAL_USERS) {
      await upsertTrialUser(prisma, user, project.id, passwordHash);
    }

    console.log(`Created/updated ${TRIAL_USERS.length} trial users for project ${project.name} (${project.id}).`);
    console.table(TRIAL_USERS.map(({ name, phone, positionKey }) => ({ name, phone, positionKey })));
    console.log(`Temporary password: ${password}`);
    console.log("mustChangePassword: true");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
