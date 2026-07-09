export function formatApiErrorMessage(message: string, status: number, fallback: string): string {
  const text = message.trim();

  if (!text) {
    return statusText(status, fallback);
  }

  if (/Failed to fetch|fetch failed|failed for fetch|NetworkError|Load failed|ECONNREFUSED/i.test(text)) {
    return "网络连接失败，请检查网络后重试。";
  }

  if (/Invalid phone or password/i.test(text)) {
    return "手机号或密码错误";
  }

  if (/Password change required/i.test(text)) {
    return "请先完成初始密码修改，再继续办理业务。";
  }

  if (/old password|current password|Invalid password/i.test(text)) {
    return "当前密码不正确";
  }

  if (/new password/i.test(text) || /at least 8/i.test(text)) {
    return "新密码至少 8 位";
  }

  if (/Missing required project role|Forbidden|File access denied/i.test(text)) {
    return "当前账号暂无该项目或当前节点的处理权限。";
  }

  if (/Missing required position|Requires global role/i.test(text)) {
    return "当前账号暂无该功能所需岗位权限。";
  }

  if (/Only the contract draft owner may edit|Only the draft owner/i.test(text)) {
    return "只有当前合同草稿负责人可以编辑。";
  }

  if (/Only the contract draft owner may manage documents/i.test(text)) {
    return "只有当前合同草稿负责人可以管理合同文件。";
  }

  if (/Layout source file must be uploaded by the actor/i.test(text)) {
    return "只能使用本人上传的版式文件。";
  }

  if (/Authenticated user is required/i.test(text)) {
    return "登录已失效，请重新登录。";
  }

  if (/Internal server error/i.test(text)) {
    return "系统暂时无法完成操作，请稍后重试或联系管理员。";
  }

  if (/not found/i.test(text)) {
    return "未找到对应业务单据，请确认单据是否存在或你是否有权查看。";
  }

  if (/fileId|archiveFileId|voucherFileId/i.test(text)) {
    return "请选择当前单据下可用的业务文件后再提交。";
  }

  if (/[A-Za-z_][A-Za-z0-9_]*/.test(text)) {
    return statusText(status, fallback);
  }

  return text;
}

export function formatUnknownApiError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return formatApiErrorMessage(error.message, 0, fallback);
  }
  return fallback;
}

function statusText(status: number, fallback: string): string {
  if (status === 0) {
    return fallback;
  }
  if (status === 401) {
    return "登录已失效，请重新登录。";
  }
  if (status === 403) {
    return "当前账号暂无该项目或当前节点的处理权限。";
  }
  if (status === 404) {
    return "未找到对应业务单据，请确认单据是否存在或你是否有权查看。";
  }
  if (status >= 500) {
    return "系统暂时无法完成操作，请稍后重试或联系管理员。";
  }
  return `${fallback}：${status}`;
}
