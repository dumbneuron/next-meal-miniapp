App({
  onLaunch() {
    const store = require('./services/store');
    store.ensureState();
    require('./services/sync').schedule();
  },
  onShow() { require('./services/sync').schedule(); }
});
