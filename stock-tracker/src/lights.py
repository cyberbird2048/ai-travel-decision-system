"""方向灯两票制：提议（quarterly_review 从 Sonnet 报告提取）+ 对抗验证（独立 Sonnet 质疑）。

目的：防止单次 Sonnet 分析的噪音随意改灯。颜色不变的维度直接采纳新 reason；
颜色变化的维度，先打包成一次 Sonnet 调用扮演质疑者反驳，verdict=uphold 才真正变灯，
reject（含解析失败）则保守维持原灯。变化（无论成立与否）都记一行 light_history.md。
"""
import json
import re
from datetime import date

from .dossier import load_dashboard, load_dossier_text, save_dashboard, stock_dir
from .llm import sonnet

CHALLENGE_PROMPT = """有人提议对以下维度的方向灯做出变更，请你扮演质疑者，尽力反驳每一条变灯理由：
证据是否充分？是否被单一事件/噪音带偏？是否与档案中其他证据矛盾？

待质疑的变灯提议：
{proposals}

对每个维度输出你的结论。最后必须附一个 JSON 代码块，格式如下：

```json
{{"verdicts": {{"<维度>": {{"verdict": "uphold" | "reject", "reason": "一句话"}}, ...}}}}
```

uphold 表示变灯理由成立，reject 表示你反驳成功、应维持原灯（原色不变）。"""


def _extract_json(text: str) -> dict | None:
    m = re.findall(r"```json\s*(\{.*?\})\s*```", text, re.S)
    if not m:
        return None
    try:
        return json.loads(m[-1])
    except json.JSONDecodeError:
        return None


def _append_history(ticker: str, dimension: str, old_color: str, new_color: str,
                     verdict: str, proposed_reason: str, challenge_reason: str) -> None:
    line = (
        f"- {date.today().isoformat()} {dimension} {old_color}→{new_color} "
        f"[{verdict}] {proposed_reason} | {challenge_reason}"
    )
    f = stock_dir(ticker) / "light_history.md"
    existing = f.read_text(encoding="utf-8") if f.exists() else "# 方向灯变更历史\n"
    f.write_text(existing + line + "\n", encoding="utf-8")


def apply_with_two_votes(ticker: str, proposed_lights: dict) -> dict:
    """将提议的方向灯与当前 dashboard 对比，颜色变化的维度走对抗验证，返回最终 lights 并写回 dashboard。"""
    current = load_dashboard(ticker)
    current_lights = current.get("lights", {})

    final_lights = dict(current_lights)
    changed = {}  # dimension -> {old, new, reason}

    for dim, proposal in proposed_lights.items():
        new_color = proposal.get("color")
        new_reason = proposal.get("reason", "")
        old = current_lights.get(dim, {})
        old_color = old.get("color", "gray")

        if new_color == old_color:
            final_lights[dim] = {"color": new_color, "reason": new_reason}
        else:
            changed[dim] = {"old_color": old_color, "new_color": new_color, "reason": new_reason}

    verdicts: dict = {}
    if changed:
        proposals_text = "\n".join(
            f"- {dim}：从 {info['old_color']} 改为 {info['new_color']}，理由：{info['reason']}"
            for dim, info in changed.items()
        )
        dossier = load_dossier_text(ticker)
        try:
            challenge = sonnet(
                CHALLENGE_PROMPT.format(proposals=proposals_text),
                dossier_context=dossier,
                task="light_challenge",
            )
            parsed = _extract_json(challenge)
            if parsed:
                verdicts = parsed.get("verdicts", {})
        except Exception as e:
            print(f"警告：对抗验证调用失败（{e}），保守维持原灯")

        for dim, info in changed.items():
            v = verdicts.get(dim, {})
            verdict = v.get("verdict", "reject")
            if verdict not in ("uphold", "reject"):
                verdict = "reject"
            challenge_reason = v.get("reason", "（解析失败，保守维持原灯）")

            if verdict == "uphold":
                final_lights[dim] = {"color": info["new_color"], "reason": info["reason"]}
            else:
                final_lights[dim] = current_lights.get(dim, {"color": info["old_color"], "reason": ""})

            _append_history(
                ticker, dim, info["old_color"], info["new_color"],
                verdict, info["reason"], challenge_reason,
            )

    save_dashboard(ticker, {
        "ticker": ticker,
        "updated": date.today().isoformat(),
        "lights": final_lights,
    })
    return final_lights
