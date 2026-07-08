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
  uploadMobileEvidence: uploadMobileEvidence
};
