"""数据采集：yfinance 基本面 + RSS 新闻。"""
import json
from datetime import date

import feedparser
import yfinance as yf

from .dossier import load_config, stock_dir


def fetch_fundamentals(ticker: str) -> dict:
    """抓取关键指标快照，写入 fundamentals.json（按日期追加历史）。"""
    t = yf.Ticker(ticker)
    info = t.info
    snapshot = {
        "date": date.today().isoformat(),
        "price": info.get("currentPrice"),
        "market_cap": info.get("marketCap"),
        "pe_trailing": info.get("trailingPE"),
        "pe_forward": info.get("forwardPE"),
        "gross_margin": info.get("grossMargins"),
        "operating_margin": info.get("operatingMargins"),
        "roe": info.get("returnOnEquity"),
        "fcf": info.get("freeCashflow"),
        "total_debt": info.get("totalDebt"),
        "shares_outstanding": info.get("sharesOutstanding"),
        "revenue_growth": info.get("revenueGrowth"),
    }
    f = stock_dir(ticker) / "fundamentals.json"
    history = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    # 同一天重复运行则覆盖
    history = [h for h in history if h["date"] != snapshot["date"]] + [snapshot]
    f.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    return snapshot


def fetch_news(ticker: str, limit: int = 20) -> list[dict]:
    cfg = load_config()
    items = []
    for feed_tpl in cfg["news_feeds"]:
        feed = feedparser.parse(feed_tpl.format(ticker=ticker))
        for e in feed.entries[:limit]:
            items.append({
                "title": e.get("title", ""),
                "summary": e.get("summary", "")[:500],
                "link": e.get("link", ""),
                "published": e.get("published", ""),
            })
    return items
