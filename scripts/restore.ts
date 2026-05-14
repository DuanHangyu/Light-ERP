import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const backupPath = process.argv[2];
if (!backupPath) {
  console.error("Usage: npm run restore -- <backup.zip>");
  process.exit(1);
}

const dataRoot = process.env.ERP_DATA_DIR
  ? path.resolve(process.env.ERP_DATA_DIR)
  : path.join(process.cwd(), "data");

fs.mkdirSync(dataRoot, { recursive: true });
const zip = new AdmZip(path.resolve(backupPath));
zip.extractAllTo(dataRoot, true);

console.log(`Restored ERP data into ${dataRoot}`);
