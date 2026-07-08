App({
  globalData: {
    apiBaseUrl: "https://jgzg.site/api",
    accessToken: "",
    refreshToken: "",
    user: null
  },
  onLaunch() {
    var session = wx.getStorageSync("jiangkong_mobile_session") || {};
    this.globalData.accessToken = session.accessToken || "";
    this.globalData.refreshToken = session.refreshToken || "";
    this.globalData.user = session.user || null;
  },
  setSession(session) {
    var nextSession = session || {};
    this.globalData.accessToken = nextSession.accessToken || "";
    this.globalData.refreshToken = nextSession.refreshToken || "";
    this.globalData.user = nextSession.user || null;
    wx.setStorageSync("jiangkong_mobile_session", nextSession);
  },
  clearSession() {
    this.globalData.accessToken = "";
    this.globalData.refreshToken = "";
    this.globalData.user = null;
    wx.removeStorageSync("jiangkong_mobile_session");
  }
});
