# Stock Fundamentals Tracker（MVP）

巴菲特式长期股票基本面追踪系统。设计文档见 `../docs/stock-fundamentals-tracker-design.md`。

## 核心理念
- **档案驱动**：每只股票是 `stocks/<TICKER>/` 下的一份公司档案（论点、护城河、商业模式、关键决策、机构观点、关键节点、上下游），全部存 git，判断的演变可 diff。
- **论点先行**：先手工写 thesis.md（投资论点 + Kill Criteria），系统之后的一切追踪都在验证或证伪它。
- **无变化也是输出**：周报明确报告"无重大变化"。
- **模型分工省 token**：deepseek-chat 做每日过滤和周报（漏斗，99% 新闻被丢弃），deepseek-reasoner 做季度深度分析和空头攻击；档案作为 system prompt 靠前内容，依赖 DeepSeek 服务端自动前缀缓存。

## 模型供应商：DeepSeek
本系统调用 DeepSeek 的 OpenAI 兼容 API（`src/llm.py`），而非 Anthropic：
- `deepseek-chat` 承担之前 Haiku 的角色（过滤/提取/汇总）
- `deepseek-reasoner` 承担之前 Sonnet 的角色（深度分析，自带思维链推理）
- DeepSeek 无 Batch API，`haiku_json_batch` 退化为逐条调用，不再有半价折扣
- DeepSeek 服务端自动做前缀缓存计费（无需显式声明），价格表在 `src/costs.py` 的 `DEEPSEEK_PRICES`，
  **务必到 [DeepSeek 官网价格页](https://api-docs.deepseek.com/quick_start/pricing) 核对最新数字**——
  记录时的价格会过期，官网调价不会自动同步到代码里。

## 快速开始
```bash
cd stock-tracker
pip install -r requirements.txt
export DEEPSEEK_API_KEY=sk-...

# 1. 建档（然后手工填写 stocks/AAPL/thesis.md）
python -m src.new_stock AAPL

# 2. 每日新闻扫描（Haiku 过滤，值得关注的写入 news_log.md）
python -m src.daily_scan

# 3. 季度深度分析（Sonnet：趋势/护城河/节点核对/空头攻击 -> 报告 + 方向灯）
#    内部已自动调用风险因素 diff 与管理层承诺提取，见下方 5/6
python -m src.quarterly_review AAPL

# 4. 周报（Haiku 汇总，不做新分析）
python -m src.weekly_report

# 5. 风险因素逐年 diff（SEC EDGAR 10-K，Haiku 中文总结新增/删除/加重的风险 -> risk_log.md）
python -m src.risk_diff AAPL

# 6. 管理层承诺提取（SEC EDGAR 10-K/10-Q MD&A，Haiku 结构化抽取 + 去重 -> milestones.yaml）
python -m src.commitments AAPL

# 7. 事件驱动触发（新 8-K / 单日股价异动 -> Haiku 严重度分级 -> 高分事件 Sonnet 深度分析）
python -m src.events

# 8. 判断回测（回看 N 个月前的方向灯/论点/季度报告，对照现在评估对错 -> 教训写入 lessons.md）
python -m src.backtest AAPL 6

# 9. 13F 机构持仓扫描（SEC EDGAR，对比最近两期持仓变动 -> Haiku 中文摘要 -> institutions.md）
#    每季度手动或定时运行一次，13F-HR 是季度披露，跑得更频繁也不会有新数据
python -m src.institutions_13f

# 10. 方向灯静态总览页（不调用 LLM，纯汇总 dashboard.json + light_history.md）
python -m src.overview
```

`src.risk_diff` / `src.commitments` 依赖 `src/edgar.py` 访问 SEC EDGAR 官方 JSON API，
使用前请在 `config.yaml` 的 `edgar.user_agent` 填上真实联系邮箱（SEC 要求 User-Agent 带联系方式）。

## 自动化
`.github/workflows/stock-tracker.yml`：交易日每日扫描、每周六周报，结果自动 commit 回仓库。
需在仓库 Settings → Secrets 配置 `DEEPSEEK_API_KEY`。
季度分析建议财报发布后手动触发（workflow_dispatch 选 `quarterly_review`）。

## 方向灯两票制
季度深度分析（`src.quarterly_review`）末尾由 Sonnet 提出方向灯变更建议，这只是"提议票"；
`src/lights.py` 会对每个颜色发生变化的维度再发起一次独立的 Sonnet 对抗验证（"质疑票"，
让模型扮演质疑者反驳变灯理由），只有验证通过（uphold）才真正写入 dashboard.json，
否则保守维持原灯（reject，含 JSON 解析失败）。同一次季度分析中多个维度同时变灯，只打包成
**一次**对抗验证调用（省 token）。每次变化（无论成立与否）都记一行到
`stocks/<TICKER>/light_history.md`，颜色不变的维度直接采纳新 reason，不需要验证。

## 判断回测 + 经验库
`src.backtest TICKER [months]`（默认 6 个月）用 git 历史找回约 N 个月前该股票档案的方向灯 +
论点 + 当时前后最近一份季度报告，交给 Sonnet 对照现在的档案（含之后的
news_log/event_log/risk_log）逐项评估：哪些预警对了、哪些变化被漏掉、哪些是误报，
提炼 1-3 条可执行的教训写入 `stocks/<TICKER>/lessons.md`。`lessons.md` 已加入
`dossier.DOSSIER_FILES`，会自动进入之后所有 Sonnet 分析（季度复查、事件分析、方向灯对抗验证）
的上下文，让系统"记住"过去判断错在哪。

## 观察池分层调度
`config.yaml` 的 `watchlist` 按 `tier` 分三层，扫描频率不同（`src/dossier.py` 的
`due_today()` 判断，`src/daily_scan.py` / `src/events.py` 在处理每只股票前都会检查）：
- `holdings`（持仓）：每日扫描
- `focus`（高关注）：每周一扫描
- `watch`（观察）：每月 1 日扫描

未知层级按 `holdings` 处理（每日扫描）。这与预算超支时"只扫 holdings 层"的降频逻辑是叠加关系，
两者都要满足才会真正扫描。

## 目录结构
```
config.yaml            观察池（holdings/focus/watch 分层）、模型分工
templates/             新股票档案模板
stocks/<TICKER>/       公司档案（thesis/moat/business/decisions/institutions/
                       milestones.yaml/valuechain.yaml/dashboard.json/
                       fundamentals.json/news_log.md/lessons.md/light_history.md）
reports/               季度分析报告、周报、回测报告
src/                   脚本
```

## 下一步（设计文档中的完整路线图）
- 年度复盘 + 估值锚更新流程

已完成：风险因素逐年 diff（`src/risk_diff.py`）、管理层承诺提取与去重（`src/commitments.py`），
均基于 `src/edgar.py` 对 SEC EDGAR 的采集，并已接入季度深度分析流程；
事件驱动触发（`src/events.py`）——新 8-K 公告 / 单日股价异动 >= 阈值时，先用 Haiku 做 1-5 分
严重度分级（漏斗第一层，全部事件写入 `event_log.md`），severity 达到阈值的再用 Sonnet
做深度分析（漏斗第二层，输出报告到 `reports/`，只建议方向灯变化、不直接改 dashboard.json）；
方向灯两票制（`src/lights.py`）——变灯提议需通过独立的 Sonnet 对抗验证才生效，历史记录写入
`light_history.md`；判断回测 + 经验库（`src/backtest.py`）——回看历史判断的对错，教训沉淀到
`lessons.md` 并自动进入之后所有分析的上下文；13F 机构持仓扫描（`src/institutions_13f.py`）——
对比知名机构最近两期 13F-HR 持仓，显著变动（>=20% 或建仓/清仓）写入 `institutions.md`；
观察池分层调度（`src/dossier.py` 的 `due_today()`）——holdings/focus/watch 三层不同扫描频率；
静态方向灯总览页（`src/overview.py`）——汇总所有股票方向灯生成 `overview.html`，近 30 天有
变灯的股票排在最前并标注。
