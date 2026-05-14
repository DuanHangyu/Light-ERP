import fs from "node:fs";
import path from "node:path";

export function getDataRoot() {
  return process.env.ERP_DATA_DIR
    ? path.resolve(process.env.ERP_DATA_DIR)
    : path.join(process.cwd(), "data");
}

export function getDataPaths() {
  const root = getDataRoot();
  return {
    root,
    database: path.join(root, "erp.sqlite"),
    attachments: path.join(root, "attachments"),
    exports: path.join(root, "exports"),
    backups: path.join(root, "backups"),
  };
}

export function ensureDataDirs() {
  const paths = getDataPaths();
  fs.mkdirSync(paths.root, { recursive: true });
  fs.mkdirSync(paths.attachments, { recursive: true });
  fs.mkdirSync(paths.exports, { recursive: true });
  fs.mkdirSync(paths.backups, { recursive: true });
  return paths;
}
