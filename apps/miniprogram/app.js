App({
  globalData: {
    apiBaseUrl: "https://jgzg.site/api",
    accessToken: ""
  },
  setAccessToken(token) {
    this.globalData.accessToken = token || "";
  }
});
