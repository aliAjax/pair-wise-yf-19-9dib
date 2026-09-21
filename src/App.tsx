import "./styles.css";

const project = {
  "sourceNo": 9,
  "id": "hxyfront-62007",
  "port": 62007,
  "title": "植物标本馆入库",
  "domain": "植物标本馆",
  "prompt": "开发一个植物标本馆压制标本入库前端项目，工作人员可以录入采集号、物种名称、采集地点、海拔、生境描述、采集人、压制状态、鉴定状态和馆藏位置。页面需要有入库队列、鉴定状态筛选、采集地点信息卡、馆藏柜位记录和单份标本详情页。",
  "palette": [
    "#166534",
    "#0f766e",
    "#ca8a04"
  ],
  "metrics": [
    "入库队列",
    "待鉴定",
    "已上柜",
    "采集点"
  ],
  "filters": [
    "待压制",
    "待鉴定",
    "已入库",
    "需补照"
  ],
  "fields": [
    "采集号",
    "物种名称",
    "采集地点",
    "海拔",
    "生境描述",
    "馆藏位置"
  ],
  "records": [
    [
      "HX-240615-01",
      "槭属待定",
      "海拔1420m",
      "待鉴定"
    ],
    [
      "HX-240615-08",
      "蕨类",
      "阴湿沟谷",
      "已压制"
    ],
    [
      "HX-240616-03",
      "菊科",
      "柜位B-12-04",
      "已入库"
    ]
  ]
};

function App() {
  return (
    <main className="app">
      <section className="hero">
        <p>{project.id} · 源提示词{project.sourceNo} · Port {project.port}</p>
        <h1>{project.title}</h1>
        <span>{project.prompt}</span>
      </section>

      <section className="metrics">
        {project.metrics.map((metric: string, index: number) => (
          <article key={metric}>
            <small>{metric}</small>
            <strong>{[86, 14, 7, 32][index] ?? 12}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>{project.domain}筛选</h2>
          <div className="chips">
            {project.filters.map((item: string) => (
              <button key={item}>{item}</button>
            ))}
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>专业字段</p>
              <h2>新增记录</h2>
            </div>
            <button className="primary">保存草稿</button>
          </div>
          <div className="field-grid">
            {project.fields.map((field: string) => (
              <label key={field}>
                <span>{field}</span>
                <input placeholder={"填写" + field} />
              </label>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>历史记录</p>
            <h2>近期工作台</h2>
          </div>
          <button>导出摘要</button>
        </div>
        <div className="records">
          {project.records.map((record: string[], index: number) => (
            <article key={record.join("-")}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <h3>{record[0]}</h3>
                <p>{record.slice(1).join(" · ")}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
