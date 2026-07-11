import { describe, expect, it } from "vitest";
import type {
  OrganizationDepartmentNode,
  OrganizationDirectoryUser
} from "../../api/organization.api";
import {
  buildCreateDepartmentPayload,
  buildDepartmentParentOptions,
  buildDepartmentPatch,
  buildUserPatch,
  departmentStatusText,
  filterOrganizationUsers,
  flattenDepartmentTree,
  globalPositionsText,
  mustChangePasswordText,
  organizationActionConsequence,
  projectPositionsText,
  userStatusText
} from "./organization.config";

const departments: OrganizationDepartmentNode[] = [
  {
    id: "root",
    name: "总部",
    parentId: null,
    isActive: true,
    children: [
      {
        id: "contract",
        name: "合同部",
        parentId: "root",
        isActive: true,
        children: [
          {
            id: "contract-a",
            name: "合同一组",
            parentId: "contract",
            isActive: true,
            children: []
          }
        ]
      },
      {
        id: "closed",
        name: "停用部门",
        parentId: "root",
        isActive: false,
        children: []
      }
    ]
  }
];

const users: OrganizationDirectoryUser[] = [
  {
    id: "user-1",
    name: "张三",
    phone: "13800000001",
    departmentId: "contract",
    departmentName: "合同部",
    status: "active",
    mustChangePassword: false,
    globalPositions: [{ key: "contract_director", name: "合同总监" }],
    projectPositions: [
      {
        projectId: "project-1",
        projectCode: "XM-001",
        projectName: "科技园项目",
        keys: ["project_manager"],
        names: ["项目经理"]
      }
    ]
  },
  {
    id: "user-2",
    name: "李四",
    phone: "13800000002",
    departmentId: null,
    departmentName: "未分配部门",
    status: "inactive",
    mustChangePassword: true,
    globalPositions: [],
    projectPositions: []
  }
];

describe("organization config", () => {
  it("flattens the department tree with depth, parent and full path", () => {
    expect(flattenDepartmentTree(departments)).toEqual([
      expect.objectContaining({ id: "root", depth: 0, parentName: "—", path: "总部" }),
      expect.objectContaining({ id: "contract", depth: 1, parentName: "总部", path: "总部 / 合同部" }),
      expect.objectContaining({
        id: "contract-a",
        depth: 2,
        parentName: "合同部",
        path: "总部 / 合同部 / 合同一组"
      }),
      expect.objectContaining({ id: "closed", depth: 1, parentName: "总部", path: "总部 / 停用部门" })
    ]);
  });

  it("outputs a malformed duplicate department only once", () => {
    const duplicate = departments[0].children[0];
    expect(flattenDepartmentTree([departments[0], duplicate]).filter((item) => item.id === "contract")).toHaveLength(1);
  });

  it("builds enabled parent options and excludes the edited department and every descendant", () => {
    expect(buildDepartmentParentOptions(departments, "contract")).toEqual([
      { label: "总部", value: "root" }
    ]);
    expect(buildDepartmentParentOptions(departments).map((option) => option.value)).toEqual([
      "root",
      "contract",
      "contract-a"
    ]);
  });

  it.each([
    [{ keyword: "张三" }, ["user-1"]],
    [{ keyword: "13800000002" }, ["user-2"]],
    [{ departmentId: "contract" }, ["user-1"]],
    [{ status: "inactive" }, ["user-2"]],
    [{ keyword: "合同总监" }, ["user-1"]],
    [{ keyword: "科技园" }, ["user-1"]],
    [{ keyword: "项目经理" }, ["user-1"]]
  ] as const)("filters organization users with %o", (filters, expectedIds) => {
    expect(filterOrganizationUsers(users, filters).map((user) => user.id)).toEqual(expectedIds);
  });

  it("formats status, password and read-only position labels", () => {
    expect(departmentStatusText(true)).toBe("启用");
    expect(departmentStatusText(false)).toBe("停用");
    expect(userStatusText("active")).toBe("启用");
    expect(userStatusText("inactive")).toBe("停用");
    expect(mustChangePasswordText(true)).toBe("待首次改密");
    expect(mustChangePasswordText(false)).toBe("已完成");
    expect(globalPositionsText(users[0])).toBe("合同总监");
    expect(globalPositionsText(users[1])).toBe("无");
    expect(projectPositionsText(users[0])).toBe("科技园项目：项目经理");
    expect(projectPositionsText(users[1])).toBe("无");
  });

  it("builds a trimmed create payload while preserving password whitespace", () => {
    expect(
      buildCreateDepartmentPayload({
        name: "  合同部  ",
        parentId: null,
        confirmationPassword: "  current password  "
      })
    ).toEqual({
      name: "合同部",
      parentId: null,
      confirmationPassword: "  current password  "
    });
  });

  it("enforces Unicode code-point limits for department name and password", () => {
    expect(
      buildCreateDepartmentPayload({
        name: "❤️".repeat(50),
        parentId: null,
        confirmationPassword: "secret"
      }).name
    ).toBe("❤️".repeat(50));
    expect(() =>
      buildCreateDepartmentPayload({
        name: `${"❤️".repeat(50)}门`,
        parentId: null,
        confirmationPassword: "secret"
      })
    ).toThrow("部门名称不能超过 100 个字符");
    expect(() =>
      buildCreateDepartmentPayload({
        name: "合同部",
        parentId: null,
        confirmationPassword: `${"❤️".repeat(128)}密`
      })
    ).toThrow("当前登录密码不能超过 256 个字符");
  });

  it("turns a clearable department parent into an explicit null patch", () => {
    expect(
      buildDepartmentPatch(
        { name: "合同部", parentId: "root", isActive: true },
        { name: "  合同管理部 ", parentId: null, isActive: true },
        " secret "
      )
    ).toEqual({ name: "合同管理部", parentId: null, confirmationPassword: " secret " });
    expect(() =>
      buildDepartmentPatch(
        { name: "合同部", parentId: null, isActive: true },
        { name: " 合同部 ", parentId: undefined, isActive: true },
        "secret"
      )
    ).toThrow("没有可保存的部门变更");
  });

  it("turns a clearable user department into null while keeping undefined as no change", () => {
    expect(
      buildUserPatch(
        { departmentId: "contract", isActive: true },
        { departmentId: null, isActive: false },
        " secret "
      )
    ).toEqual({ departmentId: null, isActive: false, confirmationPassword: " secret " });
    expect(() =>
      buildUserPatch(
        { departmentId: null, isActive: true },
        { departmentId: undefined, isActive: true },
        "secret"
      )
    ).toThrow("没有可保存的人员变更");
  });

  it("provides explicit consequences without adding another confirmation layer", () => {
    expect(organizationActionConsequence("create_department")).toContain("创建部门");
    expect(organizationActionConsequence("update_department", false)).toContain("启用人员");
    expect(organizationActionConsequence("update_user", false)).toContain("立即阻止登录");
    expect(organizationActionConsequence("update_user", false)).toContain("保留历史记录和岗位信息");
  });
});
