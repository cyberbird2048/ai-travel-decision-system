"""模型调用封装：Haiku 做便宜的过滤/汇总，Sonnet 做深度分析。

省 token 设计：
- 档案作为 system prompt 并打 cache_control，同一公司多次调用命中缓存
- Sonnet 长输出走 streaming，避免超时
- 定时批量任务走 Batch API（半价），见 haiku_json_batch
- 每次调用的 usage 记入 costs.jsonl（见 costs.py）
"""
import json
import time

import anthropic

from .costs import log_usage

HAIKU = "claude-haiku-4-5"
SONNET = "claude-sonnet-5"

_client = anthropic.Anthropic()


def haiku(prompt: str, system: str | None = None, max_tokens: int = 1024,
          task: str = "haiku") -> str:
    kwargs = {}
    if system:
        kwargs["system"] = system
    resp = _client.messages.create(
        model=HAIKU,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    log_usage(HAIKU, resp.usage, task)
    return "".join(b.text for b in resp.content if b.type == "text")


def _json_params(prompt: str, schema: dict, max_tokens: int = 1024) -> dict:
    return {
        "model": HAIKU,
        "max_tokens": max_tokens,
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
        "messages": [{"role": "user", "content": prompt}],
    }


def haiku_json(prompt: str, schema: dict, task: str = "haiku_json") -> dict:
    resp = _client.messages.create(**_json_params(prompt, schema))
    log_usage(HAIKU, resp.usage, task)
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


def haiku_json_batch(prompts: dict[str, str], schema: dict,
                     task: str = "haiku_batch",
                     poll_seconds: int = 30) -> dict[str, dict | None]:
    """批量结构化调用（Batch API，半价）。prompts: {custom_id: prompt}。

    返回 {custom_id: 解析后的 dict}，失败的条目为 None。
    定时任务对实时性无要求，多数批次几分钟内完成。
    """
    if not prompts:
        return {}
    batch = _client.messages.batches.create(requests=[
        {"custom_id": cid, "params": _json_params(p, schema)}
        for cid, p in prompts.items()
    ])
    while True:
        b = _client.messages.batches.retrieve(batch.id)
        if b.processing_status == "ended":
            break
        time.sleep(poll_seconds)

    out: dict[str, dict | None] = {cid: None for cid in prompts}
    for result in _client.messages.batches.results(batch.id):
        if result.result.type == "succeeded":
            msg = result.result.message
            log_usage(HAIKU, msg.usage, task, batch=True)
            try:
                text = next(bl.text for bl in msg.content if bl.type == "text")
                out[result.custom_id] = json.loads(text)
            except (StopIteration, json.JSONDecodeError):
                pass
        else:
            print(f"batch 条目失败 [{result.custom_id}]: {result.result.type}")
    return out


def sonnet(prompt: str, dossier_context: str, max_tokens: int = 16000,
           task: str = "sonnet") -> str:
    """深度分析。dossier_context（公司档案）作为缓存的 system prompt。"""
    with _client.messages.stream(
        model=SONNET,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": (
                    "你是一位巴菲特式的长期价值投资分析师。所有结论必须附带证据来源，"
                    "不确定的事实要明确标注。以下是这家公司的完整追踪档案：\n\n"
                    + dossier_context
                ),
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        msg = stream.get_final_message()
    log_usage(SONNET, msg.usage, task)
    return "".join(b.text for b in msg.content if b.type == "text")
