"""公司档案的读写。每只股票是 stocks/<TICKER>/ 下的一组 markdown/yaml/json 文件。"""
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
STOCKS = ROOT / "stocks"
REPORTS = ROOT / "reports"

DOSSIER_FILES = [
    "thesis.md", "moat.md", "business.md", "decisions.md",
    "institutions.md", "milestones.yaml", "valuechain.yaml",
]


def stock_dir(ticker: str) -> Path:
    return STOCKS / ticker.upper()


def load_dossier_text(ticker: str) -> str:
    """把整份档案拼成一段文本，作为 LLM 的上下文。"""
    d = stock_dir(ticker)
    parts = []
    for name in DOSSIER_FILES + ["dashboard.json"]:
        f = d / name
        if f.exists():
            parts.append(f"===== {name} =====\n{f.read_text(encoding='utf-8')}")
    return "\n\n".join(parts)


def load_dashboard(ticker: str) -> dict:
    f = stock_dir(ticker) / "dashboard.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}


def save_dashboard(ticker: str, dashboard: dict) -> None:
    f = stock_dir(ticker) / "dashboard.json"
    f.write_text(json.dumps(dashboard, ensure_ascii=False, indent=2), encoding="utf-8")


def append_log(ticker: str, filename: str, text: str) -> None:
    """追加到档案里的时间线类文件（如 decisions.md、news_log.md）。"""
    f = stock_dir(ticker) / filename
    existing = f.read_text(encoding="utf-8") if f.exists() else ""
    f.write_text(existing + "\n" + text + "\n", encoding="utf-8")


def load_config() -> dict:
    return yaml.safe_load((ROOT / "config.yaml").read_text(encoding="utf-8"))


def watchlist() -> list[dict]:
    return load_config()["watchlist"]
