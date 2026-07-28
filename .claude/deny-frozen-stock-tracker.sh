#!/usr/bin/env bash
# PreToolUse 守卫：本仓库的 stock-tracker/ 已于 2026-07 迁至 cyberbird2048/invest-os。
#
# 为什么需要这个而不是只靠 CLAUDE.md：CLAUDE.md 是提醒，模型可能在长会话里漂移；
# CI 的冻结守卫只在 push 之后报红，那时错误的写入已经发生。这个钩子在写入发生前
# 直接拒绝，是唯一在事前生效的一道。
#
# 放行 MOVED.md（迁移标记本身需要可维护）。
set -uo pipefail

payload=$(cat)

path=$(printf '%s' "$payload" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
inp = d.get("tool_input") or {}
# Write/Edit/NotebookEdit 都用 file_path
print(inp.get("file_path") or inp.get("notebook_path") or "")
' 2>/dev/null) || exit 0

[ -z "$path" ] && exit 0

case "$path" in
  */MOVED.md) exit 0 ;;
esac

# 只拦本仓库的 stock-tracker/，不影响 /workspace/invest-os/stock-tracker/。
case "$path" in
  /home/user/ai-travel-decision-system/stock-tracker/*)
    cat >&2 <<'MSG'
拒绝写入：本仓库的 stock-tracker/ 是 2026-07 迁移前的历史快照，已冻结。

正式位置是 /workspace/invest-os/stock-tracker/（仓库 cyberbird2048/invest-os，分支 main）。
把同一处改动改写到那个路径下重试。

给用户的文件链接必须写全前缀：
https://github.com/cyberbird2048/invest-os/blob/main/stock-tracker/<路径>
MSG
    exit 2
    ;;
esac

exit 0
