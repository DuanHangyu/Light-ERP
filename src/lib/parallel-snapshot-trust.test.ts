import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { runParallelCalculation } from "./parallel-calculation-engine";
import { createParallelLedger } from "./parallel-ledger-service";

function freshDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-par-snapshot-trust-"));
  process.env.ERP_DATA_DIR = dir;
}

function offsetBusinessDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe("平行账套可信时点快照", () => {
  let database: ReturnType<typeof getDb>;

  beforeAll(() => {
    freshDataDir();
    database = getDb();
  });

  it("在业务事件历史尚未建立时拒绝伪装成历史或未来时点的当前快照", () => {
    for (const baseAsOf of [offsetBusinessDate(-1), offsetBusinessDate(1)]) {
      expect(() =>
        createParallelLedger(database, "U-MGR", {
          name: `不可信基线 ${baseAsOf}`,
          purpose: "不得把当前数据标记为其他日期",
          base_as_of: baseAsOf,
          scope_type: "company",
          merge_allowed: 0,
        }),
      ).toThrow(/可信业务事件|只能选择当前业务日期/);
    }
  });

  it("为当前时点快照生成可验证的清单与总哈希", () => {
    const baseAsOf = offsetBusinessDate(0);
    const { ledgerId } = createParallelLedger(database, "U-MGR", {
      name: "可信当前基线",
      purpose: "快照清单验证",
      base_as_of: baseAsOf,
      scope_type: "company",
      merge_allowed: 0,
    });

    const entityStats = database.prepare(
      "SELECT COUNT(*) AS entity_count, COUNT(DISTINCT entity_type) AS entity_type_count FROM parallel_entity_snapshots WHERE ledger_id = ?",
    ).get(ledgerId) as { entity_count: number; entity_type_count: number };
    const manifest = database.prepare(
      "SELECT * FROM parallel_snapshot_manifests WHERE ledger_id = ?",
    ).get(ledgerId) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      ledger_id: ledgerId,
      base_as_of: baseAsOf,
      entity_count: entityStats.entity_count,
      entity_type_count: entityStats.entity_type_count,
      verification_status: "verified",
      schema_version: "parallel-snapshot-1.0",
    });
    expect(String(manifest.snapshot_hash)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(manifest.captured_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number(manifest.entity_count)).toBeGreaterThan(0);
  });

  it("快照内容被篡改后，计算前完整性校验必须阻止继续测算", () => {
    const { ledgerId } = createParallelLedger(database, "U-MGR", {
      name: "篡改阻断基线",
      purpose: "计算前校验",
      base_as_of: offsetBusinessDate(0),
      scope_type: "company",
      merge_allowed: 0,
    });
    const target = database.prepare(
      "SELECT id FROM parallel_entity_snapshots WHERE ledger_id = ? ORDER BY entity_type, entity_id LIMIT 1",
    ).get(ledgerId) as { id: string };
    database.prepare("UPDATE parallel_entity_snapshots SET payload_json = '{}' WHERE id = ?").run(target.id);

    expect(() => runParallelCalculation(database, "U-MGR", ledgerId)).toThrow(/快照完整性校验失败/);
    expect(
      database.prepare("SELECT verification_status FROM parallel_snapshot_manifests WHERE ledger_id = ?").get(ledgerId),
    ).toMatchObject({ verification_status: "invalid" });
  });
});
