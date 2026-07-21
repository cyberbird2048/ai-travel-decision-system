"""13F 机构持仓扫描：python -m src.institutions_13f

对 config.yaml 里 institutions 名单中的每家机构，取最近两期 13F-HR 持仓，
比较观察池里每只股票的持股数量变化（>=20% 相对变化 / 新建仓 / 清仓视为显著变动），
用 Haiku 生成一句中文摘要，写入 stocks/<TICKER>/institutions.md。

不引入 lxml，用标准库 xml.etree.ElementTree 解析 infoTable，剔除 XML 命名空间前缀。
"""
import xml.etree.ElementTree as ET
from datetime import date

from . import edgar
from .dossier import append_log, load_config, watchlist
from .llm import haiku

INDEX_URL = "https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_nodash}/index.json"
ARCHIVE_URL = "https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_nodash}/{filename}"

SIGNIFICANT_PCT = 20.0


def _strip_ns(tag: str) -> str:
    return tag.split("}")[-1]


def _find_two_13f_hr(cik: str) -> list[dict]:
    """返回最近两期 13F-HR 的 {accession, filing_date, report_period}，按时间倒序。"""
    data = edgar.submissions(cik)
    recent = data.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    periods = recent.get("reportDate", [])

    out = []
    for form, fdate, accession, period in zip(forms, dates, accessions, periods):
        if form == "13F-HR":
            out.append({"accession": accession, "filing_date": fdate, "report_period": period})
        if len(out) >= 2:
            break
    return out


def _fetch_infotable(cik_int: int, accession: str) -> list[dict]:
    """下载并解析某期 13F-HR 的 infoTable，返回 [{issuer, value, shares}, ...]。"""
    accession_nodash = accession.replace("-", "")
    index_resp = edgar._get(INDEX_URL.format(cik_int=cik_int, accession_nodash=accession_nodash))
    index_data = index_resp.json()
    items = index_data.get("directory", {}).get("item", [])

    target = None
    for item in items:
        name = item.get("name", "")
        lname = name.lower()
        if "infotable" in lname or (lname.endswith(".xml") and "primary_doc" not in lname):
            target = name
            break
    if not target:
        raise RuntimeError(f"未找到 infoTable 文件（accession={accession}）")

    xml_resp = edgar._get(ARCHIVE_URL.format(cik_int=cik_int, accession_nodash=accession_nodash, filename=target))
    root = ET.fromstring(xml_resp.content)

    holdings = []
    for info_table in root.iter():
        if _strip_ns(info_table.tag) != "infoTable":
            continue
        issuer = value = shares = None
        for child in info_table:
            tag = _strip_ns(child.tag)
            if tag == "nameOfIssuer":
                issuer = child.text
            elif tag == "value":
                value = child.text
            elif tag == "shrsOrPrnAmt":
                for gc in child:
                    if _strip_ns(gc.tag) == "sshPrnamt":
                        shares = gc.text
        if issuer is not None:
            holdings.append({
                "issuer": issuer.strip(),
                "value": float(value) if value else 0.0,
                "shares": int(float(shares)) if shares else 0,
            })
    return holdings


def _company_name(ticker: str) -> str:
    try:
        import yfinance as yf
        info = yf.Ticker(ticker).info
        name = info.get("shortName") or info.get("longName")
        if name:
            return name
    except Exception:
        pass
    return ticker


def _match_issuer(company_name: str, issuer: str) -> bool:
    first_word = company_name.upper().split()[0] if company_name.strip() else ""
    if not first_word:
        return False
    return first_word in issuer.upper()


def _pct_change(old: int, new: int) -> float:
    if old == 0:
        return float("inf") if new != 0 else 0.0
    return abs(new - old) / abs(old) * 100


def _is_significant(old: int, new: int) -> bool:
    if old == 0 and new != 0:
        return True  # 新建仓
    if old != 0 and new == 0:
        return True  # 清仓
    if old == 0 and new == 0:
        return False
    return _pct_change(old, new) >= SIGNIFICANT_PCT


def _sum_holding(holdings: list[dict], company_name: str) -> tuple[int, float]:
    """同一发行人在 infoTable 里可能拆成多行（不同份额类别），汇总 shares/value。"""
    total_shares = 0
    total_value = 0.0
    for h in holdings:
        if _match_issuer(company_name, h["issuer"]):
            total_shares += h["shares"]
            total_value += h["value"]
    return total_shares, total_value


def scan_institution(inst: dict, tickers_names: dict[str, str]) -> tuple[dict, list[dict]]:
    """返回 (filing_meta, changes)。filing_meta 记录两期的日期/报告期。"""
    name = inst["name"]
    cik = str(inst["cik"]).zfill(10)
    cik_int = int(cik)

    filings = _find_two_13f_hr(cik)
    if len(filings) < 2:
        raise RuntimeError(f"{name}: 找不到两期 13F-HR 公告")

    newer, older = filings[0], filings[1]
    newer_holdings = _fetch_infotable(cik_int, newer["accession"])
    older_holdings = _fetch_infotable(cik_int, older["accession"])

    changes = []
    for ticker, company_name in tickers_names.items():
        new_shares, new_value = _sum_holding(newer_holdings, company_name)
        old_shares, _old_value = _sum_holding(older_holdings, company_name)
        if _is_significant(old_shares, new_shares):
            pct = _pct_change(old_shares, new_shares)
            changes.append({
                "ticker": ticker,
                "institution": name,
                "issuer_matched": company_name,
                "old_shares": old_shares,
                "new_shares": new_shares,
                "pct_change": None if pct == float("inf") else round(pct, 1),
                "value_thousands": new_value,
            })

    meta = {
        "institution": name,
        "newer": newer,
        "older": older,
    }
    return meta, changes


def build_summary_prompt(ticker: str, changes: list[dict], metas: list[dict]) -> str:
    lines = []
    for c in changes:
        pct = f"{c['pct_change']}%" if c["pct_change"] is not None else "新建仓/清仓"
        lines.append(
            f"- {c['institution']}：持有 {c['issuer_matched']} 从 {c['old_shares']} 股 "
            f"变为 {c['new_shares']} 股（变化 {pct}），最新市值约 {c['value_thousands']} 千美元"
        )
    periods = "; ".join(
        f"{m['institution']}: {m['older']['filing_date']} -> {m['newer']['filing_date']}"
        for m in metas
    )
    return (
        f"以下是知名机构在最近两期 13F-HR 中对 {ticker} 持仓的显著变动（对比区间：{periods}）。"
        f"请用一段简短中文总结这些变动的方向和可能含义（不要过度解读，只陈述事实与合理推测）：\n\n"
        + "\n".join(lines)
    )


def main() -> None:
    cfg = load_config()
    institutions = cfg.get("institutions", [])
    stocks = watchlist()
    tickers = [s["ticker"] for s in stocks]
    tickers_names = {t: _company_name(t) for t in tickers}

    changes_by_ticker: dict[str, list[dict]] = {t: [] for t in tickers}
    metas_by_ticker: dict[str, list[dict]] = {t: [] for t in tickers}

    for inst in institutions:
        try:
            meta, changes = scan_institution(inst, tickers_names)
            for c in changes:
                changes_by_ticker[c["ticker"]].append(c)
                metas_by_ticker[c["ticker"]].append(meta)
            print(f"{inst['name']}: 检查完成，{len(changes)} 条显著变动")
        except Exception as e:
            print(f"{inst.get('name', inst)}: 处理失败（{e}），已跳过")

    today_str = date.today().isoformat()
    for ticker in tickers:
        changes = changes_by_ticker[ticker]
        if not changes:
            append_log(ticker, "institutions.md", f"- {today_str} 本季 13F 无显著变动")
            print(f"{ticker}: 本季 13F 无显著变动")
            continue

        metas = metas_by_ticker[ticker]
        periods_desc = "; ".join(
            f"{m['institution']}（{m['older']['filing_date']} -> {m['newer']['filing_date']}"
            f"{', 报告期 ' + m['newer']['report_period'] if m['newer'].get('report_period') else ''}）"
            for m in metas
        )
        prompt = build_summary_prompt(ticker, changes, metas)
        try:
            summary = haiku(prompt, task="institutions_13f")
        except Exception as e:
            summary = f"（LLM 摘要生成失败：{e}）"

        detail_lines = "\n".join(
            f"  - {c['institution']} 持有 {c['issuer_matched']}：{c['old_shares']} -> {c['new_shares']} 股"
            f"（{c['pct_change']}% 变化），市值约 {c['value_thousands']} 千美元"
            for c in changes
        )
        section = (
            f"## {today_str} 13F 机构持仓扫描\n"
            f"对比区间：{periods_desc}\n\n"
            f"摘要：{summary}\n\n"
            f"原始变动数据：\n{detail_lines}"
        )
        append_log(ticker, "institutions.md", section)
        print(f"{ticker}: {len(changes)} 条显著变动，已写入 institutions.md")


if __name__ == "__main__":
    main()
