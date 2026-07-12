CREATE TABLE "ProjectRosterMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRosterMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectRosterMember_projectId_userId_key"
ON "ProjectRosterMember"("projectId", "userId");

CREATE INDEX "ProjectRosterMember_userId_idx"
ON "ProjectRosterMember"("userId");

INSERT INTO "ProjectRosterMember" ("id", "projectId", "userId")
SELECT
    'project-roster-backfill-' || md5("projectId" || ':' || "userId"),
    "projectId",
    "userId"
FROM "ProjectMember"
GROUP BY "projectId", "userId"
ON CONFLICT ("projectId", "userId") DO NOTHING;
