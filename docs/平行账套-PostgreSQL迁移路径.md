# 平行账套 — PostgreSQL 迁移路径

> 适用：`prd-1-erp-2-rbac-bom` 平行账套功能
> 状态：路径文档（未实际切库）。按 PRD §14.4「当出现以下情况时升级 PostgreSQL」执行。

## 1. 为什么现在用 SQLite

- 单机私有化部署、单组织、数据规模小（PRD §17.1：≤100 物料、≤1000 库存流水）。
- `better-sqlite3` 同步事务，与平行账套的「快照→调整→复盘→事务化发布」模型契合，事务语义简单可靠。
- 平行账套所有 16 张 `parallel_*` 表与正式业务表同库，保证快照与合并发布的事务一致性、备份一致性。

## 2. 何时应升级 PostgreSQL（PRD §14.4 触发条件）

- 多个管理人员同时运行大范围历史重算（并发计算争抢单写者）。
- 单次纳入数十万级库存流水（复盘引擎耗时超 3s，阻塞日常业务）。
- 多工厂、多公司并行使用。
- 需要任务队列、行级锁（`SELECT ... FOR UPDATE`）、高可用数据库。

## 3. 迁移要点（保持业务规则不变）

### 3.1 SQL 兼容性
- 所有 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` 直接可用（PostgreSQL 支持）。
- `INTEGER`/`TEXT`/`REAL` 类型映射：`REAL` → `DOUBLE PRECISION`（或 `NUMERIC(18,3)` 用于金额/数量，避免浮点）。建议金额列改 `NUMERIC(18,2)`、数量列改 `NUMERIC(18,3)`。
- `row_version INTEGER`、布尔标志列（`can_view` 等）保持 `INTEGER`（0/1）或迁移为 `BOOLEAN`。
- `ON CONFLICT(...) DO UPDATE/NOTHING`（PostgreSQL 原生支持，已在快照 upsert 中使用）——无需改动。
- `database.transaction(() => {...})()`（better-sqlite3 风格）→ 改为 `BEGIN; ...; COMMIT;` 或客户端事务 API（`pg` 的 `client.query('BEGIN')` / `COMMIT`）。

### 3.2 事务与并发
- SQLite 是单写者序列化；PostgreSQL 是多版本并发。平行账套「同一账套同一时间只允许一个计算或发布任务」的约束需改用行级锁或应用层互斥（建议在 `parallel_ledgers` 上 `SELECT ... FOR UPDATE` 锁定账套行后再发布）。
- 合并发布的幂等键 `parallel_merge_requests.idempotency_key UNIQUE` 在 PostgreSQL 上同样生效。

### 3.3 连接与驱动
- `src/lib/db.ts` 的 `getDb()` 单例 → 改为连接池（`pg.Pool`）。
- `Database.Database` 类型 → `pg.Client` / `PoolClient`；prepare/run/all/get 风格 → 参数化查询 `$1,$2,...` 或继续用命名包装。
- 建议引入轻量查询封装层，使 `parallel-*.ts` 服务不直接依赖驱动类型，便于双轨。

### 3.4 备份与数据目录
- SQLite 冷备份 = 复制 `erp.sqlite`；PostgreSQL 改用 `pg_dump` / 流复制。
- `ERP_DATA_DIR/exports`、`backups` 目录结构保留；导出文件落盘逻辑不变。

## 4. 后台任务（规模化配套，PRD §17.1）

- 当前复盘引擎为同步执行（小数据量 <3s，符合 PRD 目标）。
- 升级路径：超阈值计算转入后台 worker。better-sqlite3 连接对象不能跨 `worker_threads`，需在 worker 内独立建连；PostgreSQL 下可直接用任务队列（如 `pg-boss`/外部队列）+ 独立 worker 进程。
- 前端已有 `parallel_calculation_runs.status`（running/succeeded/failed/stale）生命周期，可直接驱动轮询 UI；后台化时仅需把同步调用改为「置 running → 投递任务 → worker 写结果」。

## 5. 迁移步骤建议

1. 引入查询封装层，把 `parallel-*.ts` 对 `better-sqlite3` 的直接依赖收敛到 `db.ts`。
2. 在 `db.ts` 增加 `dialect` 配置（sqlite/postgres），保留 SQLite 为默认。
3. 编写 schema 迁移脚本（`pg_dump` schema 对齐 + 数据迁移），用 `parallel_*` 表的幂等 upsert 校验。
4. 灰度：同一基准跑 SQLite 与 PostgreSQL 两套结果，比对 `parallel_cost_projections.unit_cost` 等关键口径一致。
5. 切换 + 启用行级锁 + 上线后台 worker。

## 6. 不变量（迁移前后必须保持）

- 正式经营账套始终是日常业务唯一事实来源。
- 平行账套调整默认不改变正式业务。
- 合并只发布差异对应的正式纠错单据，不整库覆盖。
- 发布幂等、事务原子、负库存/冲突阻断合并。
- 13 码权限矩阵服务端强制（与驱动无关，迁移后继续生效）。
