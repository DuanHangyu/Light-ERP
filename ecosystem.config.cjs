const appDir = process.env.ERP_APP_DIR || "/opt/atc-erp";
const dataDir = process.env.ERP_DATA_DIR || "/data/atc-erp";
const port = process.env.PORT || "3010";

module.exports = {
  apps: [
    {
      name: "atc-erp",
      cwd: appDir,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${port}`,
      env: {
        NODE_ENV: "production",
        PORT: port,
        ERP_DATA_DIR: dataDir,
        ERP_SEED_MODE: process.env.ERP_SEED_MODE || "demo",
      },
      instances: 1,
      exec_mode: "fork",
      time: true,
      max_memory_restart: "1G",
    },
  ],
};
