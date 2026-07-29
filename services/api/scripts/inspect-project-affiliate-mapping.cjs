#!/usr/bin/env node

const { PrismaClient } = require("@prisma/client");

function buildMappingReport(projects, assignments, generatedAt = new Date()) {
  const assignmentsByProject = new Map();
  for (const assignment of assignments) {
    const current = assignmentsByProject.get(assignment.projectId) ?? [];
    current.push(assignment);
    assignmentsByProject.set(assignment.projectId, current);
  }

  const rows = projects.map((project) => {
    const current = assignmentsByProject.get(project.id) ?? [];
    const ready = current.length === 1 ? current[0] : null;
    return {
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      status: current.length === 0 ? "missing" : current.length === 1 ? "ready" : "conflict",
      affiliateName: ready?.affiliateNameSnapshot ?? null,
      affiliateCreditCode: ready?.affiliateCreditCodeSnapshot ?? null,
      businessPartyVersionId: ready?.businessPartyVersionId ?? null,
      effectiveFrom: ready?.effectiveFrom?.toISOString?.() ?? null,
      currentAssignmentIds: current.map((assignment) => assignment.id)
    };
  });

  return {
    generatedAt: generatedAt.toISOString(),
    mode: "read_only_explicit_mapping",
    notice: "未按项目名、合同相对方或历史付款方猜测挂靠企业；missing/conflict 必须人工处理。",
    summary: {
      ready: rows.filter((row) => row.status === "ready").length,
      missing: rows.filter((row) => row.status === "missing").length,
      conflict: rows.filter((row) => row.status === "conflict").length
    },
    rows
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const [projects, assignments] = await Promise.all([
      prisma.project.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: [{ code: "asc" }, { name: "asc" }]
      }),
      prisma.projectAffiliateAssignment.findMany({
        where: { endedAt: null },
        select: {
          id: true,
          projectId: true,
          businessPartyVersionId: true,
          affiliateNameSnapshot: true,
          affiliateCreditCodeSnapshot: true,
          effectiveFrom: true
        },
        orderBy: [{ projectId: "asc" }, { effectiveFrom: "desc" }, { id: "asc" }]
      })
    ]);
    process.stdout.write(`${JSON.stringify(buildMappingReport(projects, assignments), null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "项目挂靠企业映射报告生成失败"}\n`
    );
    process.exitCode = 1;
  });
}

module.exports = { buildMappingReport };
