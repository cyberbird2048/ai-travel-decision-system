---
inputs: ["brief", "card", "alternatives", "swapHint"]
output_schema: {"type":"object","required":["card"],"properties":{"card":{"type":"object"}},"additionalProperties":false}
model: deepseek-v4-flash
max_tokens: 900
---
根据 swapHint 从 alternatives 中选一张，并只改写 reason。不得创造新的价格、时刻、坐标或营业时间。

<brief>{{brief}}</brief>
<card>{{card}}</card>
<alternatives>{{alternatives}}</alternatives>
<swapHint>{{swapHint}}</swapHint>
