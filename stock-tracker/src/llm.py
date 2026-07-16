"""模型调用封装：DeepSeek-V3（deepseek-chat）做便宜的过滤/汇总，
DeepSeek-R1（deepseek-reasoner）做深度分析。

供应商：DeepSeek（OpenAI 兼容 API，https://api.deepseek.com），从 Anthropic 切换而来。
读取环境变量 DEEPSEEK_API_KEY（GitHub Actions Secrets 里配这个名字）。

省 token 设计：
- DeepSeek 服务端按 prompt 前缀自动做上下文缓存，命中部分按更低单价计费，无需显式
  cache_control；把稳定内容（公司档案）放在 system prompt 靠前的位置有助于命中。
- deepseek-reasoner 自带思维链推理（对应之前 Sonnet 深度分析的定位）。
- DeepSeek 没有 Batch API 等价物，haiku_json_batch 退化为逐条调用（无半价折扣，
  只是保留统一入口，不用改动调用方代码）。
- 每次调用的 usage 记入 costs.jsonl（见 costs.py）。

⚠️ costs.py 里的 DeepSeek 单价是记录时的官网价格，请到
https://api-docs.deepseek.com/quick_start/pricing 核对最新数字，官网会不定期调价。
"""
import json
import os

from openai import OpenAI

from .costs import log_usage

HAIKU = "deepseek-chat"       # 对应之前的 Haiku 角色：过滤/提取/汇总
SONNET = "deepseek-reasoner"  # 对应之前的 Sonnet 角色：深度分析（自带推理链）

_client = OpenAI(
    api_key=os.environ.get("DEEPSEEK_API_KEY"),
    base_url="https://api.deepseek.com",
)


class _Usage:
    """把 DeepSeek/OpenAI 风格的 usage 对象字段适配成 costs.py 期望的属性名。"""

    def __init__(self, raw):
        self.input_tokens = getattr(raw, "prompt_tokens", 0) or 0
        self.output_tokens = getattr(raw, "completion_tokens", 0) or 0
        hit = getattr(raw, "prompt_cache_hit_tokens", None)
        if hit is None:
            details = getattr(raw, "prompt_tokens_details", None)
            hit = getattr(details, "cached_tokens", 0) if details else 0
        self.cache_read_input_tokens = hit or 0
        self.cache_creation_input_tokens = 0  # DeepSeek 缓存写入不单独计费


def haiku(prompt: str, system: str | None = None, max_tokens: int = 1024,
          task: str = "haiku") -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    resp = _client.chat.completions.create(
        model=HAIKU, max_tokens=max_tokens, messages=messages,
    )
    log_usage(HAIKU, _Usage(resp.usage), task)
    return resp.choices[0].message.content or ""


def _json_messages(prompt: str, schema: dict) -> list[dict]:
    # DeepSeek 的 JSON 模式（response_format=json_object）只保证输出是合法 JSON，
    # 不像 Anthropic 的 output_config.format 那样强校验结构，所以把 schema 写进 prompt
    # 让模型自己对齐字段；仍建议用 pydantic/手工检查关键字段是否存在。
    schema_hint = (
        "请只输出一个 JSON 对象本身，不要有任何其他文字或代码块标记，"
        "字段必须符合以下 JSON Schema：\n" + json.dumps(schema, ensure_ascii=False)
    )
    return [{"role": "user", "content": f"{prompt}\n\n{schema_hint}"}]


def haiku_json(prompt: str, schema: dict, task: str = "haiku_json") -> dict:
    resp = _client.chat.completions.create(
        model=HAIKU,
        max_tokens=1024,
        response_format={"type": "json_object"},
        messages=_json_messages(prompt, schema),
    )
    log_usage(HAIKU, _Usage(resp.usage), task)
    return json.loads(resp.choices[0].message.content)


def haiku_json_batch(prompts: dict[str, str], schema: dict,
                     task: str = "haiku_batch",
                     poll_seconds: int = 30) -> dict[str, dict | None]:
    """DeepSeek 无 Batch API，退化为逐条调用（无半价折扣）。保留原签名不改调用方代码。"""
    out: dict[str, dict | None] = {}
    for cid, p in prompts.items():
        try:
            out[cid] = haiku_json(p, schema, task=task)
        except Exception as e:
            print(f"batch 条目失败 [{cid}]: {e}")
            out[cid] = None
    return out


def sonnet(prompt: str, dossier_context: str, max_tokens: int = 16000,
           task: str = "sonnet") -> str:
    """深度分析：deepseek-reasoner 自带推理链。档案放在 system prompt 靠前位置，
    依赖 DeepSeek 服务端自动前缀缓存降低重复调用成本。"""
    messages = [
        {
            "role": "system",
            "content": (
                "你是一位巴菲特式的长期价值投资分析师。所有结论必须附带证据来源，"
                "不确定的事实要明确标注。以下是这家公司的完整追踪档案：\n\n"
                + dossier_context
            ),
        },
        {"role": "user", "content": prompt},
    ]
    stream = _client.chat.completions.create(
        model=SONNET,
        max_tokens=max_tokens,
        messages=messages,
        stream=True,
        stream_options={"include_usage": True},
    )
    text_parts: list[str] = []
    usage = None
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            text_parts.append(chunk.choices[0].delta.content)
        if getattr(chunk, "usage", None):
            usage = chunk.usage
    if usage:
        log_usage(SONNET, _Usage(usage), task)
    return "".join(text_parts)
