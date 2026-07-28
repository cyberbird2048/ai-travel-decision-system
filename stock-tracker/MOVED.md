# stock-tracker 已迁出本仓库

股票追踪系统于 2026-07 迁至独立仓库，本仓库中的副本已删除。

## 唯一正式位置

- 仓库：**https://github.com/cyberbird2048/invest-os**
- 分支：**main**
- 路径：`stock-tracker/`

档案文件的链接前缀应为：
`https://github.com/cyberbird2048/invest-os/blob/main/stock-tracker/<路径>`

## 为什么整个目录被删掉，而不是留着当快照

留着的那份副本不是静态的：本仓库 `main` 上的 `.github/workflows/stock-tracker.yml`
带 cron 触发器，一直到 2026-07-27 都还在每个交易日跑 daily_scan，把结果提交回这份
旧副本。于是"过期快照"在持续产出**新的**过期内容，也在持续消耗 DeepSeek 额度，
而任何指向本仓库的旧链接都会点到它。

冻结守卫（`stock-tracker-frozen.yml`）当时只加在了
`claude/stock-fundamentals-tracker-sc1uts` 分支上，`main` 没有，所以一路没拦住。

所以处理方式是：删除 cron 工作流 + 删除目录内容，只留这份说明。
历史仍在 git 里（`git log -- stock-tracker/`，最后一次为 commit 0b4dae8），
需要考古时可随时取回，但它不会再被误当成现状。
