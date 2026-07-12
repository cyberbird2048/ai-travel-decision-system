"""每日新闻扫描（Haiku 漏斗）：python -m src.daily_scan

Haiku 对每条新闻做二分类 + 一句话摘要，99% 被丢弃；
只有"值得关注"的条目写入档案的 news_log.md，并标记涉及哪个 watch item。
"""
import json
from datetime import date

from .dossier import stock_dir, watchlist, append_log
from .fetch import fetch_news
from .llm import haiku_json

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


def scan(ticker: str) -> int:
    news = fetch_news(ticker)
    if not news:
        return 0
    milestones_f = stock_dir(ticker) / "milestones.yaml"
    milestones = milestones_f.read_text(encoding="utf-8") if milestones_f.exists() else ""

    numbered = "\n".join(
        f"[{i}] {n['title']} — {n['summary']}" for i, n in enumerate(news)
    )
    prompt = (
        f"以下是 {ticker} 的新闻列表。逐条判断：是否影响这家公司的基本面、护城河、"
        f"管理层、关键决策或下列关键节点（watch items）。日常股价波动、分析师调价、"
        f"重复消息一律 relevant=false。relevant=true 的给一句话中文摘要，"
        f"并在 watch_item 填涉及的关键节点名称（无则填空字符串）。\n\n"
        f"关键节点清单：\n{milestones}\n\n新闻：\n{numbered}"
    )
    result = haiku_json(prompt, SCHEMA)
    kept = [r for r in result["items"] if r["relevant"]]
    if kept:
        lines = [f"## {date.today().isoformat()} 每日扫描"]
        for r in kept:
            n = news[r["index"]]
            tag = f"[watch: {r['watch_item']}] " if r["watch_item"] else ""
            lines.append(f"- {tag}{r['summary']}（[来源]({n['link']})）")
        append_log(ticker, "news_log.md", "\n".join(lines))
    return len(kept)


if __name__ == "__main__":
    for s in watchlist():
        n = scan(s["ticker"])
        print(f"{s['ticker']}: 保留 {n} 条值得关注的新闻")
