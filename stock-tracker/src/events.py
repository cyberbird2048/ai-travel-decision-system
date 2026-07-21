"""事件驱动触发 + 严重度分级（漏斗第一层 Haiku，第二层 Sonnet）：python -m src.events

流程：
1. 触发器检测（不花 token）：新 8-K 公告 / 单日股价异动 >= config.events.price_move_pct
2. 严重度分级（Haiku haiku_json，task="event_severity"）：每个触发事件打 1-5 分
   所有事件（含低分）都写一行到 stocks/<TICKER>/event_log.md
3. 深度分析（Sonnet，task="event_analysis"）：severity >= config.events.severity_threshold 的事件，
   若未超预算则调用，输出报告到 reports/<TICKER>_<date>_event.md

状态文件 state.json 记录每只股票已见过的 8-K accession（避免重复触发，首次运行只记录不触发）。
"""
import json
import re
from datetime import date, datetime

import yfinance as yf

from . import edgar
from .costs import over_budget
from .dossier import REPORTS, due_today, load_config, load_dossier_text, stock_dir, watchlist

_TIER_MSG = {
    "holdings": "holdings 层每日扫描",
    "focus": "focus 层每周一扫描",
    "watch": "watch 层每月1日扫描",
}
from .llm import haiku_json, sonnet

STATE_FILE = None  # 延迟初始化，见 _state_file()

SEVERITY_SCHEMA = {
    "type": "object",
    "properties": {
        "severity": {"type": "integer"},
        "reason": {"type": "string"},
        "affects": {"type": "string"},
    },
    "required": ["severity", "reason", "affects"],
    "additionalProperties": False,
}

SEVERITY_PROMPT = """你在给一条公司事件的严重程度打分，1-5 分，含义如下：
1 = 噪音，无需关注
2 = 留意，暂不需要动作
3 = 值得分析，可能与论点相关
4 = 可能影响投资论点的某个支柱
5 = 紧急，可能触发 Kill Criteria，需要立刻复查

事件：
{event_desc}

该公司的投资论点支柱与 Kill Criteria：
{thesis_excerpt}

关键节点（milestones）：
{milestones}

请输出 severity（整数 1-5）、reason（一句话中文理由）、
affects（这条事件主要影响的维度，从"基本面/护城河/管理层/论点/无"中选一个）。"""

ANALYSIS_PROMPT = """以下是一条新事件，请分析它对投资论点的影响：

事件：
{event_desc}

严重度评分：{severity}（{reason}）

{filing_text_block}

请输出 Markdown，包含：
1. **事件影响分析**：对论点支柱 / 护城河 / 关键节点（milestones）分别影响几何
2. **Kill Criteria 核对**：是否触发档案中任一条 Kill Criteria
3. **是否建议提前跑季度复查**：是/否，理由
4. **方向灯建议**（仅供参考，不直接写入 dashboard，需人工确认后走两票制）：
   对基本面/护城河/管理层/估值/论点这几个维度给出建议的方向灯颜色变化（如有）及理由"""


def _state_file():
    from .dossier import ROOT
    return ROOT / "state.json"


def _load_state() -> dict:
    f = _state_file()
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_state(state: dict) -> None:
    _state_file().write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _extract_section(md_text: str, heading_prefix: str) -> str:
    """从 markdown 中抽取某个二级标题下的内容，直到下一个二级标题。"""
    pattern = rf"(##\s*{re.escape(heading_prefix)}.*?)(?=\n##\s|\Z)"
    m = re.search(pattern, md_text, re.S)
    return m.group(1).strip() if m else ""


def _thesis_excerpt(ticker: str) -> str:
    f = stock_dir(ticker) / "thesis.md"
    if not f.exists():
        return "（无 thesis.md）"
    text = f.read_text(encoding="utf-8")
    pillars = _extract_section(text, "论点支柱")
    kill = _extract_section(text, "Kill Criteria")
    return f"{pillars}\n\n{kill}".strip() or "（thesis.md 中未找到论点支柱 / Kill Criteria）"


def _milestones_excerpt(ticker: str, max_chars: int = 3000) -> str:
    f = stock_dir(ticker) / "milestones.yaml"
    if not f.exists():
        return "（无 milestones.yaml）"
    text = f.read_text(encoding="utf-8")
    return text[:max_chars]


def detect_8k_events(ticker: str, state: dict) -> list[dict]:
    """检测新 8-K 公告，更新 state（保留最近 20 条 accession）。首次运行只记录不触发。"""
    events = []
    try:
        filings = edgar.latest_filings(ticker, forms=("8-K",), limit=5)
    except Exception as e:
        print(f"{ticker}: 8-K 检测失败（{e}），已跳过")
        return events

    tstate = state.setdefault(ticker, {})
    seen = tstate.get("seen_8k", [])
    is_first_run = not seen
    seen_set = set(seen)

    new_accessions = [f["accession"] for f in filings if f["accession"] not in seen_set]

    if not is_first_run:
        for f in filings:
            if f["accession"] in new_accessions:
                items_txt = f" Item {f['items']}" if f.get("items") else ""
                desc = f"新 8-K 公告：{f['filing_date']}{items_txt}，主文档 {f['document']}"
                events.append({
                    "type": "8-K",
                    "ticker": ticker,
                    "description": desc,
                    "accession": f["accession"],
                    "document": f["document"],
                })

    # 更新 state：无论首次与否都记录已见的 accession
    all_seen = list(dict.fromkeys(seen + [f["accession"] for f in filings]))
    tstate["seen_8k"] = all_seen[-20:]
    tstate["last_check"] = date.today().isoformat()
    return events


def detect_price_move(ticker: str, threshold_pct: float) -> list[dict]:
    """最近两个交易日收盘价，单日涨跌幅绝对值 >= threshold_pct 时触发。"""
    events = []
    try:
        hist = yf.Ticker(ticker).history(period="5d")
        closes = hist["Close"].dropna()
        if len(closes) < 2:
            return events
        prev, last = closes.iloc[-2], closes.iloc[-1]
        if prev == 0:
            return events
        pct = (last - prev) / prev * 100
        if abs(pct) >= threshold_pct:
            direction = "上涨" if pct > 0 else "下跌"
            events.append({
                "type": "price_move",
                "ticker": ticker,
                "description": f"单日{direction} {abs(pct):.1f}%（{prev:.2f} -> {last:.2f}）",
            })
    except Exception as e:
        print(f"{ticker}: 股价异动检测失败（{e}），已跳过")
    return events


def _log_event(ticker: str, severity: int, description: str, reason: str) -> None:
    line = f"- {date.today().isoformat()} [severity {severity}] {description} — {reason}"
    f = stock_dir(ticker) / "event_log.md"
    existing = f.read_text(encoding="utf-8") if f.exists() else "# 事件日志\n"
    f.write_text(existing + line + "\n", encoding="utf-8")


def _append_analysis_link(ticker: str, report_path) -> None:
    f = stock_dir(ticker) / "event_log.md"
    if not f.exists():
        return
    text = f.read_text(encoding="utf-8")
    text += f"  → 深度分析：{report_path.relative_to(report_path.parent.parent)}\n"
    f.write_text(text, encoding="utf-8")


def score_severity(event: dict) -> dict:
    ticker = event["ticker"]
    prompt = SEVERITY_PROMPT.format(
        event_desc=event["description"],
        thesis_excerpt=_thesis_excerpt(ticker),
        milestones=_milestones_excerpt(ticker),
    )
    return haiku_json(prompt, SEVERITY_SCHEMA, task="event_severity")


def deep_analyze(event: dict, severity: int, reason: str) -> str:
    ticker = event["ticker"]
    filing_text_block = ""
    if event["type"] == "8-K":
        try:
            text = edgar.fetch_filing_text(ticker, event["accession"], event["document"])
            filing_text_block = f"8-K 原文（截断）：\n{text[:15000]}"
        except Exception as e:
            filing_text_block = f"（8-K 原文抓取失败：{e}）"

    prompt = ANALYSIS_PROMPT.format(
        event_desc=event["description"],
        severity=severity,
        reason=reason,
        filing_text_block=filing_text_block,
    )
    dossier = load_dossier_text(ticker)
    return sonnet(prompt, dossier_context=dossier, task="event_analysis")


def process_ticker(ticker: str, cfg: dict, state: dict) -> None:
    events_cfg = cfg.get("events", {})
    price_move_pct = events_cfg.get("price_move_pct", 8)
    severity_threshold = events_cfg.get("severity_threshold", 3)

    events = []
    events += detect_8k_events(ticker, state)
    events += detect_price_move(ticker, price_move_pct)

    if not events:
        print(f"{ticker}: 无新事件")
        return

    for event in events:
        try:
            result = score_severity(event)
        except Exception as e:
            print(f"{ticker}: 严重度打分失败（{e}），已跳过该事件")
            continue

        severity = result.get("severity", 1)
        reason = result.get("reason", "")
        _log_event(ticker, severity, event["description"], reason)
        print(f"{ticker}: [{event['type']}] severity={severity} {event['description']}")

        if severity >= severity_threshold:
            if over_budget():
                print(f"⚠️ {ticker}: 本周预算已超，跳过 Sonnet 深度分析（severity={severity}）")
                continue
            try:
                report = deep_analyze(event, severity, reason)
            except Exception as e:
                print(f"{ticker}: 深度分析失败（{e}），已跳过")
                continue
            REPORTS.mkdir(exist_ok=True)
            base = f"{ticker}_{date.today().isoformat()}_event"
            out = REPORTS / f"{base}.md"
            n = 2
            while out.exists():  # 同日多个事件不互相覆盖
                out = REPORTS / f"{base}_{n}.md"
                n += 1
            out.write_text(f"# {ticker} 事件深度分析 {date.today()}\n\n{report}", encoding="utf-8")
            _append_analysis_link(ticker, out)
            print(f"{ticker}: 深度分析报告已写入 {out}")


def main() -> None:
    cfg = load_config()
    state = _load_state()
    for s in watchlist():
        ticker = s["ticker"]
        if not due_today(s.get("tier", "holdings")):
            print(f"跳过 {ticker}: {_TIER_MSG.get(s.get('tier'), 'holdings 层每日扫描')}")
            continue
        try:
            process_ticker(ticker, cfg, state)
        except Exception as e:
            print(f"{ticker}: 事件处理失败（{e}），已跳过")
        _save_state(state)  # 每只股票处理完就保存，避免中途失败丢失 state


if __name__ == "__main__":
    main()
