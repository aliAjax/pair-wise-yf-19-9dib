import "./styles.css";
import { createStore } from "./herbarium/model";
import { HerbariumApp } from "./herbarium/pages";

// 应用入口：组装本地数据仓库与业务页面。
// 单例仓库：筛选、柜位记录、详情页共享同一份状态，跨标签页以外的任何操作即时同步。
const store = createStore();

function App() {
  return <HerbariumApp store={store} />;
}

export default App;
