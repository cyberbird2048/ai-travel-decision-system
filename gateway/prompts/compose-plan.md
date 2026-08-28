---
inputs: ["brief", "cards", "facts"]
output_schema: {"type":"object","required":["cards"],"properties":{"cards":{"type":"array"}},"additionalProperties":false}
model: claude-sonnet-5
max_tokens: 2400
---
仅可为已有卡片改写 reason 并调整推荐顺序，不得新增或改写 payload、costEstimate 或 geo 事实。返回卡片数必须与输入相同。

<brief>{{brief}}</brief>
<cards>{{cards}}</cards>
<facts source="adapters">{{facts}}</facts>
