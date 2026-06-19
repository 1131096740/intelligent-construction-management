import { spawnSync } from "node:child_process";

const packageManagerCli = process.env.npm_execpath;

if (!packageManagerCli || !packageManagerCli.includes("pnpm")) {
  console.error("Run this script through pnpm so workspace commands are available.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [packageManagerCli, ...process.argv.slice(2)], {
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
