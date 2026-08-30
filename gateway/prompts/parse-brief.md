---
inputs: ["input", "profile"]
output_schema: {"type":"object","required":["origin","destination","dates","party","budget","pace","intents","freeText","hardConstraints"],"properties":{"origin":{"type":"string"},"destination":{"type":"string"},"dates":{"type":"object"},"party":{"type":"array"},"budget":{"type":"object"},"pace":{"type":"number"},"intents":{"type":"array"},"freeText":{"type":"string"},"hardConstraints":{"type":"array"}},"additionalProperties":false}
model: deepseek-v4-pro
max_tokens: 1200
---
将用户输入解析为 TripBrief。不要猜测任何价格、坐标、时刻或营业时间。

<input>{{input}}</input>
<profile>{{profile}}</profile>
