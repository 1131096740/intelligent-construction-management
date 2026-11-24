Page({
  data: {
    webAddress: "https://jgzg.site"
  },
  copyWebAddress() {
    wx.setClipboardData({ data: this.data.webAddress });
  }
});
