import { Injectable, NotFoundException } from "@nestjs/common";
import { ROLE_KEYS } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { loadEffectiveProjectApprovalAssignments } from "./project-approval-assignments";

@Injectable()
export class ApprovalRuleAssignmentsService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService) {}
  async read(actorId: string, selectedProjectId?: string) {
    const ids = await this.visibility.visibleProjectIds(actorId);
    const projects = ids.length ? await this.prisma.project.findMany({where: {id: {in: ids}, isActive: true}, select: {id: true, name: true}, orderBy: {name: "asc"}}) : [];
    const projectId = selectedProjectId ?? projects[0]?.id ?? null;
    if (projectId && !projects.some(project => project.id === projectId)) throw new NotFoundException("未找到有权查看的项目");
    if (!projectId) return {projects, projectId, roles: []};
    const roleKeys = ROLE_KEYS.filter(role => role !== "super_admin" && role !== "employee");
    const assignments = await loadEffectiveProjectApprovalAssignments(this.prisma as never, projectId, roleKeys);
    const users = await this.prisma.user.findMany({where: {id: {in: [...new Set(assignments.filter(row => row.projectId === projectId && row.userIsActive).map(row => row.userId))]}, isActive: true}, select: {id: true, name: true}});
    const byId = new Map(users.map(user => [user.id, user]));
    return {projects, projectId, roles: roleKeys.map(roleKey => {
      const people = [...new Set(assignments.filter(row => row.projectId === projectId && row.userIsActive && row.roleKey === roleKey).map(row => row.userId))].flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
      return {roleKey, people, missing: people.length === 0};
    })};
  }
}
