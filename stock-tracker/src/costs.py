"""成本监控：每次 LLM 调用的 usage 记入 costs.jsonl，支持周花费统计与预算检查。"""
import json
from datetime import datetime, timedelta, timezone

from .dossier import ROOT, load_config

COSTS_FILE = ROOT / "costs.jsonl"

# DeepSeek 每百万 token 美元单价 (缓存未命中输入, 缓存命中输入, 输出)。
# ⚠️ 以下是记录时的官网价格，请到 https://api-docs.deepseek.com/quick_start/pricing
# 核对最新数字并更新——DeepSeek 会不定期调价，此表不会自动同步。
DEEPSEEK_PRICES = {
    "deepseek-chat": (0.27, 0.07, 1.10),
    "deepseek-reasoner": (0.55, 0.14, 2.19),
}

# 历史记录兼容：切换供应商前用 Anthropic 记的账，仍按其单价折算（input, output；
# 缓存读 0.1x input，缓存写 1.25x input，Batch API 半价）。
_LEGACY_ANTHROPIC_PRICES = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-5": (3.00, 15.00),
}


def _cost_usd(model: str, usage, batch: bool) -> float:
    m = 1_000_000
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0

    if model in DEEPSEEK_PRICES:
        miss_price, hit_price, out_price = DEEPSEEK_PRICES[model]
        miss_tokens = max(input_tokens - cache_read, 0)
        return (
            miss_tokens / m * miss_price
            + cache_read / m * hit_price
            + output_tokens / m * out_price
        )

    p_in, p_out = _LEGACY_ANTHROPIC_PRICES.get(model, (3.00, 15.00))
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cost = (
        input_tokens / m * p_in
        + output_tokens / m * p_out
        + cache_read / m * p_in * 0.1
        + cache_write / m * p_in * 1.25
    )
    return cost * (0.5 if batch else 1.0)


def log_usage(model: str, usage, task: str, batch: bool = False) -> None:
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "task": task,
        "model": model,
        "batch": batch,
        "input_tokens": getattr(usage, "input_tokens", 0),
        "output_tokens": getattr(usage, "output_tokens", 0),
        "cache_read": getattr(usage, "cache_read_input_tokens", 0) or 0,
        "cache_write": getattr(usage, "cache_creation_input_tokens", 0) or 0,
        "cost_usd": round(_cost_usd(model, usage, batch), 6),
    }
    with COSTS_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def spend_since(days: int) -> float:
    if not COSTS_FILE.exists():
        return 0.0
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    total = 0.0
    for line in COSTS_FILE.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
            if datetime.fromisoformat(r["ts"]) >= cutoff:
                total += r["cost_usd"]
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
    return total


def weekly_summary() -> str:
    """近 7 天成本汇总（按任务分组），供周报使用。"""
    if not COSTS_FILE.exists():
        return "本周无 LLM 调用记录。"
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    by_task: dict[str, float] = {}
    for line in COSTS_FILE.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
            if datetime.fromisoformat(r["ts"]) >= cutoff:
                by_task[r["task"]] = by_task.get(r["task"], 0.0) + r["cost_usd"]
        except (json.JSONDecodeError, KeyError, ValueError):
            continue
    total = sum(by_task.values())
    lines = [f"- {task}: ${cost:.4f}" for task, cost in sorted(by_task.items())]
    budget = load_config().get("budget", {}).get("weekly_usd")
    budget_line = f"（预算 ${budget}）" if budget else ""
    return f"本周 LLM 成本合计 **${total:.4f}**{budget_line}\n" + "\n".join(lines)


def over_budget() -> bool:
    budget = load_config().get("budget", {}).get("weekly_usd")
    return budget is not None and spend_since(7) >= budget
