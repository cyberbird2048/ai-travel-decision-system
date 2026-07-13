"""每日新闻扫描（Haiku 漏斗，Batch API 半价）：python -m src.daily_scan

所有股票的新闻打包成一个 batch 提交；Haiku 对每条新闻做二分类 + 一句话摘要，
99% 被丢弃；只有"值得关注"的条目写入档案的 news_log.md，并标记涉及的 watch item。

预算控制：本周花费超过 config.budget.weekly_usd 时，只扫描 holdings 层。
"""
from datetime import date

from .costs import over_budget, spend_since
from .dossier import stock_dir, watchlist, append_log
from .fetch import fetch_news
from .llm import haiku_json_batch

SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "relevant": {"type": "boolean"},
                    "summary": {"type": "string"},
                    "watch_item": {"type": "string"},
                },
                "required": ["index", "relevant", "summary", "watch_item"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["items"],
    "additionalProperties": False,
}


def build_prompt(ticker: str, news: list[dict]) -> str:
    milestones_f = stock_dir(ticker) / "milestones.yaml"
    milestones = milestones_f.read_text(encoding="utf-8") if milestones_f.exists() else ""
    numbered = "\n".join(
        f"[{i}] {n['title']} — {n['summary']}" for i, n in enumerate(news)
    )
    return (
        f"以下是 {ticker} 的新闻列表。逐条判断：是否影响这家公司的基本面、护城河、"
        f"管理层、关键决策或下列关键节点（watch items）。日常股价波动、分析师调价、"
        f"重复消息一律 relevant=false。relevant=true 的给一句话中文摘要，"
        f"并在 watch_item 填涉及的关键节点名称（无则填空字符串）。\n\n"
        f"关键节点清单：\n{milestones}\n\n新闻：\n{numbered}"
    )


def main() -> None:
    stocks = watchlist()
    if over_budget():
        print(f"⚠️ 本周花费 ${spend_since(7):.2f} 已超预算，本次只扫描 holdings 层")
        stocks = [s for s in stocks if s["tier"] == "holdings"]

    news_by_ticker = {s["ticker"]: fetch_news(s["ticker"]) for s in stocks}
    prompts = {
        t: build_prompt(t, news) for t, news in news_by_ticker.items() if news
    }
    results = haiku_json_batch(prompts, SCHEMA, task="daily_scan")

    for ticker, result in results.items():
        if result is None:
            print(f"{ticker}: batch 失败，跳过")
            continue
        news = news_by_ticker[ticker]
        kept = [r for r in result["items"] if r["relevant"] and 0 <= r["index"] < len(news)]
        if kept:
            lines = [f"## {date.today().isoformat()} 每日扫描"]
            for r in kept:
                n = news[r["index"]]
                tag = f"[watch: {r['watch_item']}] " if r["watch_item"] else ""
                lines.append(f"- {tag}{r['summary']}（[来源]({n['link']})）")
            append_log(ticker, "news_log.md", "\n".join(lines))
        print(f"{ticker}: 保留 {len(kept)} 条值得关注的新闻")


if __name__ == "__main__":
    main()
