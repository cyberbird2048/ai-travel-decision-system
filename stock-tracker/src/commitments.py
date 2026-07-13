"""管理层承诺提取：python -m src.commitments TICKER

流程：抓最新一份 10-K 或 10-Q 的 MD&A 章节 -> Haiku 结构化抽取前瞻性承诺
（产品时间线、毛利率目标、资本开支计划、回购计划等）-> 与 milestones.yaml 里
已有的 active 节点做去重判断（也用 Haiku）-> 把真正新增的追加进 active 列表。
"""
import sys

import yaml

from .dossier import stock_dir
from .edgar import extract_section, fetch_filing_text, latest_filings
from .llm import haiku_json

MAX_MDNA_CHARS = 20000

EXTRACT_SCHEMA = {
    "type": "object",
    "properties": {
        "commitments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "承诺内容，一句话概括"},
                    "expected_timing": {"type": "string", "description": "预期兑现时间，找不到写'未注明'"},
                    "quote": {"type": "string", "description": "原文中的简短逐字引用"},
                },
                "required": ["content", "expected_timing", "quote"],
            },
        }
    },
    "required": ["commitments"],
}

EXTRACT_PROMPT = """以下是一家公司最新 10-K/10-Q 的「管理层讨论与分析」（MD&A）章节节选：

{mdna_text}

请找出其中管理层做出的前瞻性承诺/目标，例如：产品或功能上市时间表、毛利率或利润率目标、
资本开支计划、股票回购计划、产能扩张计划等。只抽取有具体内容的承诺，不要抽取空泛的表态
（如"我们致力于为股东创造价值"这类不算）。每条给出简短原文引用作为证据。"""

DEDUP_SCHEMA = {
    "type": "object",
    "properties": {
        "new_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "expected_timing": {"type": "string"},
                    "quote": {"type": "string"},
                },
                "required": ["content", "expected_timing", "quote"],
            },
            "description": "候选中确认是全新的、不与已有节点重复的条目",
        }
    },
    "required": ["new_items"],
}

DEDUP_PROMPT = """档案里已经在追踪的关键节点（milestones.yaml 的 active 列表）：

{existing}

刚从最新财报 MD&A 中抽取出的候选承诺：

{candidates}

请判断候选中哪些是与已有节点实质重复（同一件事，哪怕措辞不同也算重复），
哪些是真正新增、值得单独追踪的承诺。只把真正新增的放进 new_items，原样保留其字段。"""


def _load_mdna(ticker: str) -> tuple[str, dict]:
    """优先用最新 10-K，没有就退而求其次用最新 10-Q。返回 (mdna文本, 公告信息)。"""
    filings = latest_filings(ticker, forms=("10-K", "10-Q"), limit=5)
    if not filings:
        raise RuntimeError(f"{ticker}：未找到任何 10-K/10-Q 公告")
    filing = filings[0]
    text = fetch_filing_text(ticker, filing["accession"], filing["document"])
    mdna = extract_section(text, "mdna")
    return mdna, filing


def run(ticker: str) -> int:
    """提取管理层承诺并合并进 milestones.yaml，返回新增条目数。"""
    mdna, filing = _load_mdna(ticker)
    if not mdna:
        print(f"{ticker}：未能从 {filing['form']} 中定位到 MD&A 章节，跳过")
        return 0

    mdna = mdna[:MAX_MDNA_CHARS]
    extracted = haiku_json(
        EXTRACT_PROMPT.format(mdna_text=mdna), EXTRACT_SCHEMA, task="commitments"
    )
    candidates = extracted.get("commitments", [])
    if not candidates:
        print(f"{ticker}：MD&A 中未提取到具体的管理层承诺")
        return 0

    milestones_path = stock_dir(ticker) / "milestones.yaml"
    data = yaml.safe_load(milestones_path.read_text(encoding="utf-8")) if milestones_path.exists() else {}
    data.setdefault("active", [])
    data.setdefault("history", [])

    existing_summary = "\n".join(f"- {item.get('item', '')}" for item in data["active"]) or "（暂无）"
    candidates_summary = "\n".join(
        f"- {c['content']}（预期时间: {c['expected_timing']}）" for c in candidates
    )
    dedup = haiku_json(
        DEDUP_PROMPT.format(existing=existing_summary, candidates=candidates_summary),
        DEDUP_SCHEMA,
        task="commitments",
    )
    new_items = dedup.get("new_items", [])

    for item in new_items:
        data["active"].append({
            "item": item["content"],
            "来源": "管理层承诺",
            "首次提出": f"{filing['filing_date']} {filing['form']}",
            "预期时间": item.get("expected_timing", "未注明"),
            "当前状态": "按计划",
            "最新证据": item.get("quote", ""),
            "对论点的影响": "待评估",
            "跳票次数": 0,
        })

    if new_items:
        milestones_path.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )

    print(f"{ticker}：新增 {len(new_items)} 条管理层承诺到 milestones.yaml")
    return len(new_items)


if __name__ == "__main__":
    ticker = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    run(ticker)
