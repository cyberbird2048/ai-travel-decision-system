# Stock Fundamentals Tracker（MVP）

巴菲特式长期股票基本面追踪系统。设计文档见 `../docs/stock-fundamentals-tracker-design.md`。

## 核心理念
- **档案驱动**：每只股票是 `stocks/<TICKER>/` 下的一份公司档案（论点、护城河、商业模式、关键决策、机构观点、关键节点、上下游），全部存 git，判断的演变可 diff。
- **论点先行**：先手工写 thesis.md（投资论点 + Kill Criteria），系统之后的一切追踪都在验证或证伪它。
- **无变化也是输出**：周报明确报告"无重大变化"。
- **模型分工省 token**：Haiku 做每日过滤和周报（漏斗，99% 新闻被丢弃），Sonnet 做季度深度分析和空头攻击；档案作为缓存的 system prompt。

## 快速开始
```bash
cd stock-tracker
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...

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
```

`src.risk_diff` / `src.commitments` 依赖 `src/edgar.py` 访问 SEC EDGAR 官方 JSON API，
使用前请在 `config.yaml` 的 `edgar.user_agent` 填上真实联系邮箱（SEC 要求 User-Agent 带联系方式）。

## 自动化
`.github/workflows/stock-tracker.yml`：交易日每日扫描、每周六周报，结果自动 commit 回仓库。
需在仓库 Settings → Secrets 配置 `ANTHROPIC_API_KEY`。
季度分析建议财报发布后手动触发（workflow_dispatch 选 `quarterly_review`）。

## 目录结构
```
config.yaml            观察池（holdings/focus/watch 分层）、模型分工
templates/             新股票档案模板
stocks/<TICKER>/       公司档案（thesis/moat/business/decisions/institutions/
                       milestones.yaml/valuechain.yaml/dashboard.json/
                       fundamentals.json/news_log.md）
reports/               季度分析报告、周报
src/                   脚本
```

## 下一步（设计文档中的完整路线图）
- 13F 机构持仓扫描（SEC EDGAR）
- 静态方向灯总览页
- 年度复盘 + 估值锚更新流程

已完成：风险因素逐年 diff（`src/risk_diff.py`）、管理层承诺提取与去重（`src/commitments.py`），
均基于 `src/edgar.py` 对 SEC EDGAR 的采集，并已接入季度深度分析流程；
事件驱动触发（`src/events.py`）——新 8-K 公告 / 单日股价异动 >= 阈值时，先用 Haiku 做 1-5 分
严重度分级（漏斗第一层，全部事件写入 `event_log.md`），severity 达到阈值的再用 Sonnet
做深度分析（漏斗第二层，输出报告到 `reports/`，只建议方向灯变化、不直接改 dashboard.json）。
