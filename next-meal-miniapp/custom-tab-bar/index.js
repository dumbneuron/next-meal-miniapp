Component({
  data: {
    selected: 0,
    items: [
      { path: '/pages/today/index', label: '今日', mark: '⌂' },
      { path: '/pages/plan/index', label: '计划', mark: '▦' },
      { path: '/pages/record/index', label: '记一餐', mark: '＋' },
      { path: '/pages/trend/index', label: '趋势', mark: '⌁' },
      { path: '/pages/settings/index', label: '我的', mark: '◯' }
    ]
  },
  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      wx.switchTab({ url: this.data.items[index].path });
    }
  }
});
