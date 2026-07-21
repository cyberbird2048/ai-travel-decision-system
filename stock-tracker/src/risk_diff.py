"""风险因素逐年 diff：python -m src.risk_diff TICKER

流程：抓最近两份 10-K 的 Risk Factors（Item 1A）章节 -> difflib 做纯文本 diff
（先省 token，只把新增/删除的段落喂给 LLM）-> Haiku 用中文总结新增/删除/措辞加重的风险
-> 追加到 stocks/<TICKER>/risk_log.md。
"""
import difflib
import sys
from datetime import date

from .dossier import append_log
from .edgar import extract_section, fetch_filing_text, latest_filings
from .llm import haiku

MAX_DIFF_CHARS = 8000

PROMPT = """以下是同一家公司两份 10-K「风险因素」章节之间的文本 diff（+ 开头为新增段落，
- 开头为删除段落，diff 已裁剪，可能不完整）：

{diff_text}

请用中文简要总结：
1. 新增了哪些风险（具体到主题，不要泛泛而谈）
2. 删除/不再提及了哪些风险
3. 哪些措辞明显加重（比如从"可能"变成"很可能""已经导致"）

没有明显变化的类别直接跳过，不要硬凑。"""


def _unified_diff(old_text: str, new_text: str) -> str:
    """段落级 diff，只保留 +/- 行，节省喂给 LLM 的 token。"""
    old_paras = [p.strip() for p in old_text.split("\n\n") if p.strip()]
    new_paras = [p.strip() for p in new_text.split("\n\n") if p.strip()]
    diff = difflib.unified_diff(old_paras, new_paras, lineterm="")
    changed = [line for line in diff if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))]
    return "\n".join(changed)


def run(ticker: str) -> None:
    """抓取最近两份 10-K 的风险因素并 diff，写入 risk_log.md。无 LLM 调用则不追加时不消耗预算。"""
    ten_ks = latest_filings(ticker, forms=("10-K",), limit=2)
    if len(ten_ks) < 2:
        print(f"{ticker}：可用的 10-K 不足两份，跳过风险因素 diff")
        return

    newer, older = ten_ks[0], ten_ks[1]
    newer_text = extract_section(
        fetch_filing_text(ticker, newer["accession"], newer["document"]), "risk_factors"
    )
    older_text = extract_section(
        fetch_filing_text(ticker, older["accession"], older["document"]), "risk_factors"
    )

    if not newer_text or not older_text:
        print(f"{ticker}：未能从 10-K 中定位到风险因素章节，跳过")
        return

    diff_text = _unified_diff(older_text, newer_text)
    if not diff_text.strip():
        print(f"{ticker}：两份 10-K 的风险因素章节文本无差异")
        diff_text = "（无文本差异）"
    else:
        diff_text = diff_text[:MAX_DIFF_CHARS]

    summary = haiku(PROMPT.format(diff_text=diff_text), max_tokens=1024, task="risk_diff")

    log_entry = (
        f"## {date.today().isoformat()} 风险因素 diff"
        f"（{older['filing_date']} 10-K vs {newer['filing_date']} 10-K）\n\n{summary}\n"
    )
    append_log(ticker, "risk_log.md", log_entry)
    print(f"{ticker}：风险因素 diff 已写入 risk_log.md")


if __name__ == "__main__":
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    run(ticker)
