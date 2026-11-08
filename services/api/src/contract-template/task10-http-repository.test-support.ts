import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Resolve this test's repository; keep cwd and package identity guards in copies. */
export async function task10HttpRepository(testDirectory: string) {
  const repository = await realpath(resolve(testDirectory, "../../../.."));
  if (await realpath(process.cwd()) !== join(repository, "services/api")) throw new Error("任务10公开核对需要当前源码对应的 API目录");
  const workspacePackage = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const apiPackage = JSON.parse(await readFile(join(repository, "services/api/package.json"), "utf8"));
  if (workspacePackage.name !== "jiangkong" || apiPackage.name !== "@jiangkong/api") throw new Error("任务10公开核对需要建工智管 API源码目录");
  return repository;
}
