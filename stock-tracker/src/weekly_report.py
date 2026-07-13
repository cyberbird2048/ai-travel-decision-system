"""周报（Haiku，只汇总已有结论，不做新分析）：python -m src.weekly_report"""
from datetime import date

from .costs import weekly_summary
from .dossier import REPORTS, load_dashboard, stock_dir, watchlist
from .llm import haiku


def build() -> str:
    sections = []
    for s in watchlist():
        t = s["ticker"]
        dash = load_dashboard(t)
        lights = dash.get("lights", {})
        light_str = " ".join(
            f"{k}:{ {'green':'🟢','yellow':'🟡','red':'🔴'}.get(v.get('color'),'⚪') }"
            for k, v in lights.items()
        )
        log_f = stock_dir(t) / "news_log.md"
        recent = log_f.read_text(encoding="utf-8")[-3000:] if log_f.exists() else "（本周无记录）"
        sections.append(f"### {t}（{s['tier']}）{light_str}\n近期记录：\n{recent}")

    summary = haiku(
        "以下是本周各股票的方向灯和新闻记录。写一份简短中文周报：先列有变化/需要关注的股票，"
        "再明确列出'本周无重大变化'的股票（这也是有价值的信息）。不要新增分析。\n\n"
        + "\n\n".join(sections),
        max_tokens=2000,
        task="weekly_report",
    )
    cost = weekly_summary()
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"weekly_{date.today().isoformat()}.md"
    out.write_text(
        f"# 周报 {date.today()}\n\n{summary}\n\n---\n\n## 成本\n{cost}",
        encoding="utf-8",
    )
    print(f"周报已写入 {out}")
    return summary


if __name__ == "__main__":
    print(build())
