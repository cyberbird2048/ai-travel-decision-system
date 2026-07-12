"""模型调用封装：Haiku 做便宜的过滤/汇总，Sonnet 做深度分析。

省 token 设计：
- 档案作为 system prompt 并打 cache_control，同一公司多次调用命中缓存
- Sonnet 长输出走 streaming，避免超时
"""
import json
import anthropic

HAIKU = "claude-haiku-4-5"
SONNET = "claude-sonnet-5"

_client = anthropic.Anthropic()


def haiku(prompt: str, system: str | None = None, max_tokens: int = 1024) -> str:
    kwargs = {}
    if system:
        kwargs["system"] = system
    resp = _client.messages.create(
        model=HAIKU,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    return "".join(b.text for b in resp.content if b.type == "text")


def haiku_json(prompt: str, schema: dict, system: str | None = None) -> dict:
    kwargs = {}
    if system:
        kwargs["system"] = system
    resp = _client.messages.create(
        model=HAIKU,
        max_tokens=1024,
        output_config={"format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text)


def sonnet(prompt: str, dossier_context: str, max_tokens: int = 16000) -> str:
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
    return "".join(b.text for b in msg.content if b.type == "text")
