var api = require("../../utils/api");

Page({
  data: {
    phone: "",
    password: "",
    loading: false,
    error: ""
  },
  onLoad: function() {
    var data = getApp().globalData || {};
    if (data.accessToken) {
      wx.redirectTo({ url: "/pages/work-items/index" });
    }
  },
  onPhoneInput: function(event) {
    this.setData({ phone: event.detail.value });
  },
  onPasswordInput: function(event) {
    this.setData({ password: event.detail.value });
  },
  submitLogin: function() {
    var page = this;
    var phone = (page.data.phone || "").trim();
    var password = page.data.password || "";
    if (!phone || !password) {
      page.setData({ error: "请填写手机号和当前密码" });
      return;
    }
    page.setData({ loading: true, error: "" });
    api
      .loginByPhone(phone, password)
      .then(function() {
        wx.redirectTo({ url: "/pages/work-items/index" });
      })
      .catch(function(error) {
        page.setData({ error: error.message || "登录失败" });
      })
      .finally(function() {
        page.setData({ loading: false });
      });
  }
});
