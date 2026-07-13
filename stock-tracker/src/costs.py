"""成本监控：每次 LLM 调用的 usage 记入 costs.jsonl，支持周花费统计与预算检查。"""
import json
from datetime import datetime, timedelta, timezone

from .dossier import ROOT, load_config

COSTS_FILE = ROOT / "costs.jsonl"

# 每百万 token 美元单价 (input, output)。缓存读 0.1x input，缓存写 1.25x input。
PRICES = {
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-sonnet-5": (3.00, 15.00),
}


def _cost_usd(model: str, usage, batch: bool) -> float:
    p_in, p_out = PRICES.get(model, (3.00, 15.00))
    m = 1_000_000
    cost = (
        getattr(usage, "input_tokens", 0) / m * p_in
        + getattr(usage, "output_tokens", 0) / m * p_out
        + (getattr(usage, "cache_read_input_tokens", 0) or 0) / m * p_in * 0.1
        + (getattr(usage, "cache_creation_input_tokens", 0) or 0) / m * p_in * 1.25
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
