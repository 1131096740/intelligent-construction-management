interface ApprovalWorkItemTarget {
  targetPath: string;
}

interface ApprovalWorkItemRouter {
  push(target: string): unknown;
}

export function navigateToApprovalWorkItem(
  router: ApprovalWorkItemRouter,
  item: ApprovalWorkItemTarget
) {
  return router.push(item.targetPath);
}
