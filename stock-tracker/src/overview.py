"""静态方向灯总览页（不调用 LLM）：python -m src.overview

汇总所有股票的 dashboard.json 方向灯 + light_history.md 最近 30 天变化，
生成一个自包含的静态 HTML 页面 overview.html，方便一眼扫过整个观察池。
"""
import html
import re
from datetime import date, datetime, timedelta

from .dossier import ROOT, load_dashboard, stock_dir, watchlist

OUT_FILE = ROOT / "overview.html"

COLOR_EMOJI = {"green": "🟢", "yellow": "🟡", "red": "🔴"}
DEFAULT_EMOJI = "⚪"

_HISTORY_LINE_RE = re.compile(r"^-\s*(\d{4}-\d{2}-\d{2})\s")


def _recent_change_dates(ticker: str, days: int = 30) -> list[str]:
    f = stock_dir(ticker) / "light_history.md"
    if not f.exists():
        return []
    cutoff = date.today() - timedelta(days=days)
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        m = _HISTORY_LINE_RE.match(line)
        if not m:
            continue
        try:
            d = date.fromisoformat(m.group(1))
        except ValueError:
            continue
        if d >= cutoff:
            out.append(m.group(1))
    return out


def _emoji(color: str) -> str:
    return COLOR_EMOJI.get(color, DEFAULT_EMOJI)


def build_rows() -> list[dict]:
    rows = []
    for s in watchlist():
        ticker = s["ticker"]
        tier = s.get("tier", "holdings")
        dash = load_dashboard(ticker)
        lights = dash.get("lights", {})
        updated = dash.get("updated") or "（未评估）"
        recent_changes = _recent_change_dates(ticker)
        rows.append({
            "ticker": ticker,
            "tier": tier,
            "lights": lights,
            "updated": updated,
            "recent_changed": bool(recent_changes),
        })
    # 近期变灯的排到最前
    rows.sort(key=lambda r: (not r["recent_changed"], r["ticker"]))
    return rows


DIMENSIONS = ["基本面", "护城河", "管理层", "估值", "论点"]

STYLE = """
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    margin: 0; padding: 2rem;
    background: #eceff1; color: #222;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #22262b; color: #e6e6e6; }
    .card { background: #2d3237 !important; border-color: #444 !important; }
    th { background: #383d42 !important; color: #eee !important; }
    td { border-color: #444 !important; }
    .badge { background: #4a4020 !important; color: #ffe08a !important; }
  }
  h1 { font-size: 1.4rem; margin-bottom: 0.2rem; }
  .meta { color: #667; margin-bottom: 1.5rem; font-size: 0.9rem; }
  .card {
    background: #f5f6f7; border: 1px solid #d6d9dc; border-radius: 10px;
    padding: 1rem 1.2rem; overflow-x: auto;
  }
  table { border-collapse: collapse; width: 100%; min-width: 600px; }
  th, td {
    padding: 0.5rem 0.8rem; text-align: center; border: 1px solid #d6d9dc;
    font-size: 0.95rem;
  }
  th { background: #dde1e4; font-weight: 600; }
  td.ticker-cell { text-align: left; font-weight: 600; white-space: nowrap; }
  .tier { font-size: 0.75rem; color: #778; font-weight: 400; margin-left: 0.3rem; }
  .light { font-size: 1.3rem; cursor: default; }
  .badge {
    display: inline-block; background: #fff3cd; color: #7a5b00;
    border-radius: 6px; padding: 0.1rem 0.5rem; font-size: 0.75rem; margin-left: 0.4rem;
  }
  .updated-cell { color: #667; font-size: 0.85rem; white-space: nowrap; }
</style>
"""


def render_html(rows: list[dict]) -> str:
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    header_cells = "".join(f"<th>{dim}</th>" for dim in DIMENSIONS)

    body_rows = []
    for r in rows:
        light_cells = []
        for dim in DIMENSIONS:
            info = r["lights"].get(dim, {})
            color = info.get("color", "gray")
            reason = html.escape(info.get("reason", "未评估") or "未评估")
            light_cells.append(f'<td><span class="light" title="{reason}">{_emoji(color)}</span></td>')
        badge = ' <span class="badge">⚡ 近期变灯</span>' if r["recent_changed"] else ""
        body_rows.append(
            f'<tr><td class="ticker-cell">{html.escape(r["ticker"])}'
            f'<span class="tier">({html.escape(r["tier"])})</span>{badge}</td>'
            + "".join(light_cells)
            + f'<td class="updated-cell">{html.escape(str(r["updated"]))}</td></tr>'
        )

    return f"""<title>方向灯总览</title>
{STYLE}
<h1>观察池方向灯总览</h1>
<div class="meta">生成时间：{generated} ｜ 观察池股票数：{len(rows)}</div>
<div class="card">
<table>
  <thead>
    <tr><th>股票</th>{header_cells}<th>更新日期</th></tr>
  </thead>
  <tbody>
    {''.join(body_rows)}
  </tbody>
</table>
</div>
"""


def main() -> None:
    rows = build_rows()
    OUT_FILE.write_text(render_html(rows), encoding="utf-8")
    print(f"总览页已生成：{OUT_FILE}")


if __name__ == "__main__":
    main()
