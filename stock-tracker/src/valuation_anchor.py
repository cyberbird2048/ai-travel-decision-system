"""估值锚自动刷新：取分析师目标价分布，写入 stocks/<TICKER>/thesis.md 的估值锚表格。

用法：
    python -m src.valuation_anchor          # 跑整个 watchlist
    python -m src.valuation_anchor AAPL      # 只跑指定股票

纯数据脚本，不调用 LLM。
"""
import re
import sys
from datetime import date

import requests
import yfinance as yf

from .dossier import stock_dir, watchlist


def _make_session() -> requests.Session:
    """yfinance 默认用 curl_cffi 模拟浏览器指纹，在有 TLS 中间代理的环境下会被重置连接；
    换成普通 requests.Session 更稳（沙箱/代理环境下验证有效）。"""
    s = requests.Session()
    s.headers.update({"User-Agent": "Mozilla/5.0"})
    return s


def fetch_price_targets(ticker: str) -> dict | None:
    """取分析师目标价 low/median/high（可选 mean/numberOfAnalysts）。取不到三个核心值则返回 None。"""
    t = yf.Ticker(ticker, session=_make_session())

    low = median = high = None
    n_analysts = None

    try:
        pt = t.analyst_price_targets
    except Exception:
        pt = None

    if isinstance(pt, dict):
        low = pt.get("low")
        median = pt.get("median")
        high = pt.get("high")

    if low is None or median is None or high is None:
        try:
            info = t.info
        except Exception:
            info = {}
        low = low if low is not None else info.get("targetLowPrice")
        median = median if median is not None else info.get("targetMedianPrice")
        high = high if high is not None else info.get("targetHighPrice")
        if median is None:
            median = info.get("targetMeanPrice")
        n_analysts = info.get("numberOfAnalystOpinions")

    if low is None or median is None or high is None:
        return None

    return {"low": float(low), "median": float(median), "high": float(high), "n_analysts": n_analysts}


def compute_bands(low: float, median: float, high: float) -> dict:
    """三档区间：悲观 = low~(low+median)/2；基准 = (low+median)/2~median；乐观 = median~high。"""
    mid_low = (low + median) / 2
    return {
        "bear": (low, mid_low),
        "base": (mid_low, median),
        "bull": (median, high),
    }


def fmt_range(lo: float, hi: float) -> str:
    return f"${lo:.0f} ~ ${hi:.0f}"


ROW_RE = {
    "bear": re.compile(r"^(\|\s*悲观\s*\|.*?\|)([^|]*)(\|)\s*$", re.MULTILINE),
    "base": re.compile(r"^(\|\s*基准\s*\|.*?\|)([^|]*)(\|)\s*$", re.MULTILINE),
    "bull": re.compile(r"^(\|\s*乐观\s*\|.*?\|)([^|]*)(\|)\s*$", re.MULTILINE),
}

REFRESH_LINE_RE = re.compile(r"^（最近刷新[^\n]*\n?", re.MULTILINE)


def update_thesis(ticker: str, targets: dict, bands: dict) -> bool:
    """更新 thesis.md 表格。找不到某行则打印警告并跳过该行；返回是否有任何写入。"""
    f = stock_dir(ticker) / "thesis.md"
    if not f.exists():
        print(f"[{ticker}] 警告: thesis.md 不存在，跳过")
        return False

    text = f.read_text(encoding="utf-8")
    changed = False

    for key in ("bear", "base", "bull"):
        pattern = ROW_RE[key]
        lo, hi = bands[key]
        replacement_cell = f" {fmt_range(lo, hi)} "
        new_text, n = pattern.subn(lambda m: m.group(1) + replacement_cell + m.group(3), text)
        if n == 0:
            label = {"bear": "悲观", "base": "基准", "bull": "乐观"}[key]
            print(f"[{ticker}] 警告: 找不到表格行 '| {label} |'，跳过该行")
        else:
            text = new_text
            changed = True

    # 刷新说明行
    today = date.today().isoformat()
    n_analysts = targets.get("n_analysts")
    n_part = f"，机构数={n_analysts}（numberOfAnalystOpinions）" if n_analysts else ""
    refresh_line = (
        f"（最近刷新：{today}，来源：yfinance 分析师目标价 "
        f"low=${targets['low']:.0f} median=${targets['median']:.0f} high=${targets['high']:.0f}{n_part}）\n"
    )

    if REFRESH_LINE_RE.search(text):
        text = REFRESH_LINE_RE.sub(refresh_line, text, count=1)
    else:
        if not text.endswith("\n"):
            text += "\n"
        text += refresh_line
    changed = True

    if changed:
        f.write_text(text, encoding="utf-8")
    return changed


def run_ticker(ticker: str) -> None:
    ticker = ticker.upper()
    targets = fetch_price_targets(ticker)
    if targets is None:
        print(f"[{ticker}] 警告: 拿不到分析师目标价 low/median/high，跳过")
        return
    bands = compute_bands(targets["low"], targets["median"], targets["high"])
    update_thesis(ticker, targets, bands)
    print(
        f"[{ticker}] 悲观 {fmt_range(*bands['bear'])} | "
        f"基准 {fmt_range(*bands['base'])} | "
        f"乐观 {fmt_range(*bands['bull'])}"
    )


def main():
    if len(sys.argv) > 1:
        tickers = [sys.argv[1]]
    else:
        tickers = [w["ticker"] for w in watchlist()]

    for t in tickers:
        run_ticker(t)


if __name__ == "__main__":
    main()
