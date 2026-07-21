"""判断回测 + 经验库：python -m src.backtest TICKER [months]

回看约 N 个月前该股票档案的状态（方向灯 + thesis + 当时前后最近一份季度报告），
对照现在的档案（含之后的 news_log/event_log/risk_log），让 Sonnet 逐项评估哪些预警
对了、哪些漏了、哪些是误报，提炼 1-3 条教训，追加到 stocks/<TICKER>/lessons.md——
经验库通过 dossier.DOSSIER_FILES 自动进入之后所有 Sonnet 分析的上下文。
"""
import glob
import json
import re
import subprocess
import sys
from datetime import date, timedelta

from .dossier import REPORTS, ROOT, load_dossier_text, stock_dir, watchlist
from .llm import sonnet

REPO_ROOT = ROOT.parent

PROMPT = """以下是 {months} 个月前对这家公司的判断（方向灯 + 论点 + 当时的分析摘录）：

{past_snapshot}

档案中的"当前状态"已经包含到今天为止的完整追踪记录（news_log/event_log/risk_log 等），
请对照当时的判断与这段时间实际发生的事，逐项评估：
1. 哪些预警是对的（当时点出的风险后来确实发生/加深）
2. 哪些变化被漏掉了（当时没预见到、后来发生的重要变化）
3. 哪些是误报（当时担心的事后来没有发生或影响甚微）

最后提炼 1-3 条可执行的教训（lesson），每条一句话，说明当时判断错/对的原因，
应该是"下次遇到类似情况该怎么做"这种可操作的经验，不是空泛的总结。

输出末尾附 JSON 代码块：
```json
{{"lessons": ["...", "..."]}}
```"""


def _run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git"] + args, cwd=REPO_ROOT, capture_output=True, text=True,
    )
    return result.stdout.strip()


def _find_past_commit(ticker: str, before_date: str) -> str | None:
    rel = f"stock-tracker/stocks/{ticker.upper()}/"
    out = _run_git(["log", f"--before={before_date}", "-1", "--format=%H", "--", rel])
    return out or None


def _git_show(commit: str, rel_path: str) -> str | None:
    result = subprocess.run(
        ["git", "show", f"{commit}:{rel_path}"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def _nearest_past_report(ticker: str, target_date: date) -> str | None:
    """在 reports/ 目录（工作区）中找当时前后最近的一份季度报告，按文件名日期匹配。"""
    if not REPORTS.exists():
        return None
    pattern = str(REPORTS / f"{ticker.upper()}_*_quarterly.md")
    candidates = []
    for path in glob.glob(pattern):
        m = re.search(r"_(\d{4}-\d{2}-\d{2})_quarterly\.md$", path)
        if not m:
            continue
        try:
            d = date.fromisoformat(m.group(1))
        except ValueError:
            continue
        candidates.append((abs((d - target_date).days), path))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0][1]


def backtest(ticker: str, months: int = 6) -> None:
    ticker = ticker.upper()
    target_date = date.today() - timedelta(days=months * 30)
    before_str = target_date.isoformat()

    commit = _find_past_commit(ticker, before_str)
    if not commit:
        print(f"{ticker}: 历史不足 {months} 个月，跳过回测")
        return

    rel_dir = f"stock-tracker/stocks/{ticker}"
    dashboard_text = _git_show(commit, f"{rel_dir}/dashboard.json") or "（当时无 dashboard.json）"
    thesis_text = _git_show(commit, f"{rel_dir}/thesis.md") or "（当时无 thesis.md）"

    report_path = _nearest_past_report(ticker, target_date)
    if report_path:
        with open(report_path, encoding="utf-8") as f:
            report_excerpt = f.read()[:6000]
        report_block = f"当时前后最近的季度报告（{report_path}）：\n{report_excerpt}"
    else:
        report_block = "（未找到当时前后的季度报告，仅用方向灯+论点）"

    past_snapshot = (
        f"当时方向灯（dashboard.json）：\n{dashboard_text}\n\n"
        f"当时投资论点（thesis.md）：\n{thesis_text}\n\n"
        f"{report_block}"
    )

    dossier = load_dossier_text(ticker)
    report = sonnet(
        PROMPT.format(months=months, past_snapshot=past_snapshot),
        dossier_context=dossier,
        task="backtest",
    )

    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / f"{ticker}_{date.today().isoformat()}_backtest.md"
    out.write_text(f"# {ticker} 判断回测（{months} 个月前 vs 现在）{date.today()}\n\n{report}", encoding="utf-8")
    print(f"回测报告已写入 {out}")

    m = re.findall(r"```json\s*(\{.*?\})\s*```", report, re.S)
    lessons = []
    if m:
        try:
            lessons = json.loads(m[-1]).get("lessons", [])
        except json.JSONDecodeError:
            pass

    if lessons:
        f = stock_dir(ticker) / "lessons.md"
        existing = f.read_text(encoding="utf-8") if f.exists() else "# 经验库\n"
        block = f"\n## {date.today().isoformat()}（来自 {months} 个月回测）\n"
        block += "\n".join(f"- {lesson}" for lesson in lessons) + "\n"
        f.write_text(existing + block, encoding="utf-8")
        print(f"{len(lessons)} 条教训已追加到 {f}")
    else:
        print("警告：报告中未找到 lessons JSON，lessons.md 未更新")


if __name__ == "__main__":
    ticker = sys.argv[1]
    months = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    backtest(ticker, months)
