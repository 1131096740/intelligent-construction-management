function appData() {
  return getApp().globalData || {};
}

function request(path, options) {
  var data = appData();
  var headers = Object.assign(
    {
      "Content-Type": "application/json"
    },
    options && options.header ? options.header : {}
  );

  if (data.accessToken) {
    headers.Authorization = "Bearer " + data.accessToken;
  }

  return new Promise(function(resolve, reject) {
    wx.request({
      url: data.apiBaseUrl + path,
      method: options && options.method ? options.method : "GET",
      data: options && options.data ? options.data : undefined,
      header: headers,
      success: function(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (response.statusCode === 401) {
          getApp().clearSession();
          wx.redirectTo({ url: "/pages/login/index" });
        }
        reject(new Error(formatError(response)));
      },
      fail: reject
    });
  });
}

function formatError(response) {
  var body = response.data || {};
  if (typeof body.message === "string") {
    return body.message;
  }
  return "请求失败：" + response.statusCode;
}

function fetchWorkItems() {
  return request("/me/work-items");
}

function loginByPhone(phone, password) {
  return request("/auth/login", {
    method: "POST",
    data: {
      phone: phone,
      password: password
    }
  }).then(function(result) {
    getApp().setSession({
      accessToken: result.tokens && result.tokens.accessToken,
      refreshToken: result.tokens && result.tokens.refreshToken,
      user: result.user || null
    });
    return result;
  });
}

function reviewApproval(item, decision, comment) {
  var businessType = item.businessType || "";
  var businessId = item.businessId || "";
  var projectId = item.projectId || "";
  var path = approvalPath(businessType, businessId, projectId);
  return request(path, {
    method: "POST",
    data: {
      decision: decision,
      comment: comment || undefined
    }
  });
}

function approvalPath(businessType, businessId, projectId) {
  if (businessType === "contract_version") {
    return "/contracts/" + encodeURIComponent(businessId) + "/approval";
  }
  if (businessType === "settlement") {
    return "/settlements/" + encodeURIComponent(businessId) + "/approval";
  }
  if (businessType === "payment_request") {
    return "/payments/" + encodeURIComponent(businessId) + "/approval";
  }
  if (businessType === "project_expense_request" && projectId) {
    return (
      "/projects/" +
      encodeURIComponent(projectId) +
      "/expense-requests/" +
      encodeURIComponent(businessId) +
      "/approval"
    );
  }
  throw new Error("当前待办暂不支持移动审批");
}

function uploadMobileEvidence(filePath, business) {
  return new Promise(function(resolve, reject) {
    var data = appData();
    var formData = Object.assign({}, business || {});
    wx.uploadFile({
      url: data.apiBaseUrl + "/files/private",
      filePath: filePath,
      name: "file",
      formData: formData,
      header: data.accessToken ? { Authorization: "Bearer " + data.accessToken } : {},
      success: function(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            resolve(JSON.parse(response.data));
          } catch (error) {
            reject(error);
          }
          return;
        }
        reject(new Error("上传失败：" + response.statusCode));
      },
      fail: reject
    });
  });
}

module.exports = {
  fetchWorkItems: fetchWorkItems,
  loginByPhone: loginByPhone,
  reviewApproval: reviewApproval,
  uploadMobileEvidence: uploadMobileEvidence
};
