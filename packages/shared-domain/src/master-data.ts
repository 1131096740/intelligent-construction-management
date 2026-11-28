import type { RoleKey } from "./roles";

/** 公司基础资料的维护岗位；业务审批和财务确认仍由各自权限控制。 */
export const MASTER_DATA_MAINTAINER_ROLES = [
  "comprehensive_director",
  "chairman"
] as const satisfies readonly RoleKey[];

/** 仅项目名称和编号等基础资料；单位档案仍遵守两岗维护限制。 */
export const PROJECT_BASIC_MAINTAINER_ROLES = [
  "comprehensive_director", "chairman", "general_manager"
] as const satisfies readonly RoleKey[];
