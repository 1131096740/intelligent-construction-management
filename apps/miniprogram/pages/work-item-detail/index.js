var api = require("../../utils/api");

Page({
  data: {
    item: null,
    canApprove: false,
    approvalComment: "",
    actionMessage: "",
    actionBusy: "",
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
    this.setData({ item: item, canApprove: canApprove(item) });
  },
  onApprovalCommentInput: function(event) {
    this.setData({ approvalComment: event.detail.value });
  },
  approveItem: function() {
    this.submitApproval("approve");
  },
  rejectItem: function() {
    this.submitApproval("reject");
  },
  submitApproval: function(decision) {
    var item = this.data.item || {};
    var page = this;
    if (!this.data.canApprove) {
      page.setData({ actionMessage: "当前待办暂不支持移动审批" });
      return;
    }
    page.setData({ actionBusy: decision, actionMessage: "" });
    api
      .reviewApproval(item, decision, this.data.approvalComment)
      .then(function() {
        page.setData({ actionMessage: decision === "approve" ? "审批已通过" : "审批已驳回" });
        setTimeout(function() {
          wx.navigateBack();
        }, 600);
      })
      .catch(function(error) {
        page.setData({ actionMessage: error.message || "审批提交失败" });
      })
      .finally(function() {
        page.setData({ actionBusy: "" });
      });
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

function canApprove(item) {
  return item && item.type === "approval" && item.businessType && item.businessId;
}
