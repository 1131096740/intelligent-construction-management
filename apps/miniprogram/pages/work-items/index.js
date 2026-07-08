var api = require("../../utils/api");

Page({
  data: {
    loading: false,
    error: "",
    groups: []
  },
  onShow: function() {
    this.loadWorkItems();
  },
  loadWorkItems: function() {
    var page = this;
    page.setData({ loading: true, error: "" });
    api
      .fetchWorkItems()
      .then(function(result) {
        page.setData({ groups: normalizeGroups(result) });
      })
      .catch(function(error) {
        page.setData({ error: error.message || "加载待办失败" });
      })
      .finally(function() {
        page.setData({ loading: false });
      });
  },
  openItem: function(event) {
    var groupIndex = event.currentTarget.dataset.groupIndex;
    var itemIndex = event.currentTarget.dataset.itemIndex;
    var item = this.data.groups[groupIndex].items[itemIndex];
    wx.navigateTo({
      url: "/pages/work-item-detail/index?item=" + encodeURIComponent(JSON.stringify(item))
    });
  }
});

function normalizeGroups(result) {
  var groups = [
    { title: "待我审批", items: result.pendingApprovals || [] },
    { title: "待我处理", items: result.pendingActions || [] },
    { title: "我发起的进行中", items: result.startedByMe || [] },
    { title: "委托给我", items: result.delegatedToMe || [] },
    { title: "超时催办", items: result.overdueReminders || [] }
  ];
  return groups.filter(function(group) {
    return group.items.length > 0;
  });
}
