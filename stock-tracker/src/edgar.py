"""SEC EDGAR 采集：CIK 查询、最新公告清单、原文抓取、章节抽取。

使用 SEC 官方免费 JSON API（https://data.sec.gov/），无需 API Key，但要求：
- 请求头带 User-Agent（形如 "公司/项目名 联系邮箱"），配置见 config.yaml 的 edgar.user_agent
- 限速 10 req/s，本模块每次请求后 sleep 0.15s 留出余量

不引入 bs4/lxml，纯 html.parser 去标签取正文，够用且减少依赖。
"""
import json
import re
import time
from html.parser import HTMLParser

import requests

from .dossier import ROOT, load_config

CACHE_DIR = ROOT / ".cache"
TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
ARCHIVES_URL = "https://www.sec.gov/Archives/edgar/data/{cik_int}/{accession_nodash}/{document}"

_RATE_SLEEP = 0.15


def _headers() -> dict:
    cfg = load_config()
    ua = cfg.get("edgar", {}).get("user_agent") or "stock-tracker research@example.com"
    return {"User-Agent": ua}


def _get(url: str, **kwargs) -> requests.Response:
    """带限速与统一错误信息的 GET 请求。"""
    try:
        resp = requests.get(url, headers=_headers(), timeout=20, **kwargs)
        resp.raise_for_status()
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"访问 SEC EDGAR 失败：{url} ({e})") from e
    finally:
        time.sleep(_RATE_SLEEP)
    return resp


def _ticker_map_cache_path():
    return CACHE_DIR / "company_tickers.json"


def _load_ticker_map() -> dict:
    """ticker -> 10位补零 CIK，本地缓存避免每次调用都重新下载。"""
    cache = _ticker_map_cache_path()
    if cache.exists():
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass  # 缓存损坏则重新下载

    resp = _get(TICKER_MAP_URL)
    raw = resp.json()
    mapping = {
        row["ticker"].upper(): str(row["cik_str"]).zfill(10)
        for row in raw.values()
    }
    CACHE_DIR.mkdir(exist_ok=True)
    cache.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
    return mapping


def get_cik(ticker: str) -> str:
    """返回 10 位补零的 CIK 字符串，找不到则抛错。"""
    mapping = _load_ticker_map()
    cik = mapping.get(ticker.upper())
    if not cik:
        raise ValueError(f"在 SEC 公司列表中找不到股票代码 {ticker}，请确认代码是否正确")
    return cik


def latest_filings(ticker: str, forms=("10-K", "10-Q", "8-K"), limit: int = 10) -> list[dict]:
    """返回最近的公告清单：[{form, filing_date, accession, document, url}, ...]，按时间倒序。"""
    cik = get_cik(ticker)
    resp = _get(SUBMISSIONS_URL.format(cik=cik))
    data = resp.json()
    recent = data.get("filings", {}).get("recent", {})

    forms_list = recent.get("form", [])
    dates = recent.get("filingDate", [])
    accessions = recent.get("accessionNumber", [])
    docs = recent.get("primaryDocument", [])

    cik_int = int(cik)
    out = []
    for form, fdate, accession, doc in zip(forms_list, dates, accessions, docs):
        if forms and form not in forms:
            continue
        accession_nodash = accession.replace("-", "")
        url = ARCHIVES_URL.format(cik_int=cik_int, accession_nodash=accession_nodash, document=doc)
        out.append({
            "form": form,
            "filing_date": fdate,
            "accession": accession,
            "document": doc,
            "url": url,
        })
        if len(out) >= limit:
            break
    return out


class _TextExtractor(HTMLParser):
    """极简 HTML 转纯文本：丢弃 script/style，块级标签之间插入换行。"""

    _BLOCK_TAGS = {"p", "div", "tr", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table"}

    def __init__(self):
        super().__init__()
        self._skip = 0
        self.chunks: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in self._BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip > 0:
            self._skip -= 1
        elif tag in self._BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_data(self, data):
        if self._skip == 0 and data.strip():
            self.chunks.append(data)

    def text(self) -> str:
        raw = "".join(self.chunks)
        # 折叠多余空白，保留段落换行
        raw = re.sub(r"[ \t\xa0]+", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


def fetch_filing_text(ticker: str, accession: str, document: str) -> str:
    """下载指定公告的主文档并转为纯文本。"""
    cik = get_cik(ticker)
    accession_nodash = accession.replace("-", "")
    url = ARCHIVES_URL.format(cik_int=int(cik), accession_nodash=accession_nodash, document=document)
    resp = _get(url)
    parser = _TextExtractor()
    parser.feed(resp.text)
    return parser.text()


# Item 编号 -> 常见标题关键词，用于启发式定位章节起止
_SECTION_PATTERNS = {
    "risk_factors": (
        r"item\s*1a\.?\s*risk\s*factors",
        r"item\s*1b\.?\s*unresolved",  # 常见的下一个 item，作为结束边界之一
    ),
    "mdna": (
        r"item\s*[27]\.?\s*management.?s?\s*discussion\s*(and|&)\s*analysis",
        r"item\s*[38]\.?\s*(quantitative|financial\s*statements)",
    ),
}


def extract_section(text: str, section: str) -> str:
    """从 10-K/10-Q 全文中启发式抽取指定章节，找不到返回空字符串。

    section 取 "risk_factors" 或 "mdna"（Management's Discussion）。
    做法：用 Item 编号 + 标题关键词的正则找起点，下一个已知 Item 的正则找终点；
    正文里同一标题常在目录里出现一次、正文里出现一次，取"最后一次匹配"更可能命中正文而非目录。
    """
    key = "risk_factors" if section.lower() in ("risk factors", "risk_factors", "item 1a") else (
        "mdna" if section.lower() in (
            "mdna", "management's discussion", "management’s discussion", "item 7", "item 2"
        ) else None
    )
    if key is None:
        return ""

    start_pat, end_pat = _SECTION_PATTERNS[key]
    start_matches = list(re.finditer(start_pat, text, re.I))
    if not start_matches:
        return ""
    start = start_matches[-1].start()

    end_matches = [m for m in re.finditer(end_pat, text, re.I) if m.start() > start]
    end = end_matches[0].start() if end_matches else min(len(text), start + 40000)

    section_text = text[start:end].strip()
    return section_text


if __name__ == "__main__":
    import sys

    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    filings = latest_filings(ticker)
    for f in filings:
        print(f"{f['filing_date']}  {f['form']:6s}  {f['accession']}  {f['url']}")
