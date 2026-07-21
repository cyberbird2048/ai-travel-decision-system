"""从模板脚手架一只新股票的档案：python -m src.new_stock AAPL"""
import sys
from pathlib import Path

from .dossier import ROOT, stock_dir

TEMPLATES = ROOT / "templates"


def scaffold(ticker: str) -> None:
    ticker = ticker.upper()
    d = stock_dir(ticker)
    if d.exists():
        print(f"{ticker} 档案已存在：{d}")
        return
    d.mkdir(parents=True)
    for tpl in TEMPLATES.iterdir():
        content = tpl.read_text(encoding="utf-8").replace("{TICKER}", ticker)
        (d / tpl.name).write_text(content, encoding="utf-8")
    print(f"已创建 {ticker} 档案：{d}")
    print("下一步：手工填写 thesis.md 的投资论点和 Kill Criteria（这一步不该交给 AI）")


if __name__ == "__main__":
    scaffold(sys.argv[1])
