import type { RoleKey } from "./roles";

/** 公司基础资料的维护岗位；业务审批和财务确认仍由各自权限控制。 */
export const MASTER_DATA_MAINTAINER_ROLES = [
  "comprehensive_director",
  "chairman"
] as const satisfies readonly RoleKey[];
