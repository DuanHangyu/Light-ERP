import { getDb } from "../src/lib/db";
import {
  PARALLEL_DEMO_RESET_CONFIRMATION,
  resetParallelDemoData,
} from "../src/lib/parallel-demo-reset-service";

const confirmation = process.argv
  .find((argument) => argument.startsWith("--confirm="))
  ?.slice("--confirm=".length);

if (confirmation !== PARALLEL_DEMO_RESET_CONFIRMATION) {
  console.error(`拒绝执行：请使用 --confirm=${PARALLEL_DEMO_RESET_CONFIRMATION} 明确确认。`);
  process.exitCode = 1;
} else {
  try {
    const result = resetParallelDemoData(getDb(), "U-ADMIN", confirmation);
    console.log(`平行账套演示数据已清空。`);
    console.log(`备份文件：${result.backupName}`);
    console.log(`删除账套：${result.deleted.ledgers} 套；模拟单据：${result.deleted.simulationDocuments} 张；合并申请：${result.deleted.mergeRequests} 个。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "平行账套演示数据重置失败。");
    process.exitCode = 1;
  }
}
