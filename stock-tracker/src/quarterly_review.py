"""季度深度分析（Sonnet）：python -m src.quarterly_review [TICKER]

流程：抓最新基本面 -> Sonnet 带完整档案做深度分析 + 空头攻击 ->
输出分析报告到 reports/，并更新方向灯 dashboard.json。
"""
import json
import re
import sys
from datetime import date

from .dossier import (REPORTS, load_dossier_text, save_dashboard,
                      stock_dir, watchlist)
from .fetch import fetch_fundamentals
from .llm import sonnet

PROMPT = """最新基本面快照：
{snapshot}

请完成季度深度复查，输出 Markdown 报告，包含以下部分：

1. **基本面趋势**：对比档案中的历史数据，指出趋势与拐点（不是复述数字）
2. **护城河检查**：有无侵蚀/加深的新证据
3. **关键节点核对**：逐条核对 milestones 中 active 节点的状态，指出跳票
4. **上下游信号**：valuechain 中领先指标有无异动
5. **空头攻击**：扮演空头，用最强的论据攻击当前投资论点
6. **Kill Criteria 核对**：逐条判断是否触发
7. **方向灯**：最后输出一个 JSON 代码块，格式如下（color 取 green/yellow/red）：

```json
{{"基本面": {{"color": "...", "reason": "一句话"}}, "护城河": {{...}}, "管理层": {{...}}, "估值": {{...}}, "论点": {{...}}}}
```

所有判断附证据；无重大变化的维度明确写"无重大变化"——这本身就是有价值的结论。"""


def review(ticker: str) -> None:
    snapshot = fetch_fundamentals(ticker)
    dossier = load_dossier_text(ticker)
    report = sonnet(
        PROMPT.format(snapshot=json.dumps(snapshot, ensure_ascii=False, indent=2)),
        dossier_context=dossier,
    )

    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"{ticker}_{date.today().isoformat()}_quarterly.md"
    out.write_text(f"# {ticker} 季度深度分析 {date.today()}\n\n{report}", encoding="utf-8")
    print(f"报告已写入 {out}")

    # 从报告末尾提取方向灯 JSON 并更新 dashboard
    m = re.findall(r"```json\s*(\{.*?\})\s*```", report, re.S)
    if m:
        lights = json.loads(m[-1])
        save_dashboard(ticker, {
            "ticker": ticker,
            "updated": date.today().isoformat(),
            "lights": lights,
        })
        print("方向灯已更新：", {k: v["color"] for k, v in lights.items()})
    else:
        print("警告：报告中未找到方向灯 JSON，dashboard 未更新")


if __name__ == "__main__":
    tickers = [sys.argv[1]] if len(sys.argv) > 1 else [s["ticker"] for s in watchlist()]
    for t in tickers:
        review(t)
