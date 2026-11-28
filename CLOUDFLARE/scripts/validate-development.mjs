import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cloudflareRoot, "..");
const manifestPath = path.join(repoRoot, "TOOLS", "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const toolsRoot = path.join(repoRoot, "TOOLS");
const activeTools = manifest.tools.filter(tool => tool.enabled !== false);
const failures = [];
const checkFile = file => {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(path.relative(repoRoot, file) + ": " + (result.stderr || result.stdout || "JavaScript syntax check failed").trim());
};
const metadata = (source, tag) => {
  const line = source.split(/\r?\n/).map(item => item.trim()).find(item => item.startsWith("// @" + tag + " "));
  return line ? line.slice(("// @" + tag).length).trim() : "";
};

if (!activeTools.length) failures.push("No enabled tools found in TOOLS/manifest.json.");

for (const tool of activeTools) {
  const file = path.join(toolsRoot, tool.file);
  try {
    const source = await fs.readFile(file, "utf8");
    const matches = source.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("// @match ")).map(line => line.slice(10).trim());
    if (metadata(source, "name") !== tool.name) failures.push(tool.id + ": @name does not match the manifest.");
    if (metadata(source, "version") !== "1") failures.push(tool.id + ": @version must be 1.");
    if (metadata(source, "author") !== "Mohamed Saleh") failures.push(tool.id + ": @author must be Mohamed Saleh.");
    if (!matches.length || JSON.stringify(matches) !== JSON.stringify(tool.matches || [])) failures.push(tool.id + ": manifest match patterns do not match @match metadata.");
    if (!source.includes(tool.id) || !source.includes("TOOL_ID")) failures.push(tool.id + ": tool identity is missing.");
    if (!source.includes("registry[TOOL_ID]")) failures.push(tool.id + ": tool registry registration is missing.");
    if (!source.includes("destroy(") && !source.includes("destroy:")) failures.push(tool.id + ": destroy lifecycle is missing.");
    checkFile(file);
  } catch {
    failures.push(tool.id + ": source file is missing: " + tool.file);
  }
}

for (const relative of [
  "CORE/tools-manager.js",
  "CORE/module-loader.js",
  "CLOUDFLARE/public/runtime/core-tools-manager.js",
  "CLOUDFLARE/public/runtime/core-module-loader.js",
  "CLOUDFLARE/public/runtime/dashboard-ui.js",
  "CLOUDFLARE/src/index.js"
]) {
  checkFile(path.join(repoRoot, relative));
}

for (const relative of ["CLOUDFLARE/migrations", "CLOUDFLARE/public", "CLOUDFLARE/src"]) {
  try {
    await fs.access(path.join(repoRoot, relative));
  } catch {
    failures.push("Required project path is missing: " + relative);
  }
}

if (failures.length) {
  process.stderr.write(failures.map(item => "ERROR: " + item).join("\n") + "\n");
  process.exit(1);
}

process.stdout.write("Validated " + activeTools.length + " active tools and core Cloudflare runtime modules.\n");
