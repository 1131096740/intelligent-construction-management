var api = require("../../utils/api");

Page({
  data: {
    item: null,
    uploadMessage: "",
    uploading: false
  },
  onLoad: function(query) {
    var item = {};
    try {
      item = JSON.parse(decodeURIComponent(query.item || "{}"));
    } catch (error) {
      item = {};
    }
    this.setData({ item: item });
  },
  chooseAndUpload: function() {
    var page = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["camera", "album"],
      success: function(result) {
        var file = result.tempFiles && result.tempFiles[0];
        if (!file) return;
        page.uploadEvidence(file.tempFilePath);
      }
    });
  },
  uploadEvidence: function(filePath) {
    var item = this.data.item || {};
    var page = this;
    page.setData({ uploading: true, uploadMessage: "" });
    api
      .uploadMobileEvidence(filePath, {
        businessType: item.businessType || "",
        businessId: item.businessId || item.id || "",
        source: "miniprogram"
      })
      .then(function() {
        page.setData({ uploadMessage: "附件已上传，等待业务页确认。" });
      })
      .catch(function(error) {
        page.setData({ uploadMessage: error.message || "上传失败" });
      })
      .finally(function() {
        page.setData({ uploading: false });
      });
  }
});
