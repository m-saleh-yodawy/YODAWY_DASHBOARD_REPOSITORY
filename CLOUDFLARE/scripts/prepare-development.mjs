import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(cloudflareRoot, "..");
const buildRoot = path.join(cloudflareRoot, ".dev-build");
const publicRoot = path.join(buildRoot, "public");
const productionUrl = "https://yodawy-dashboard.m-saleh-yodawy.workers.dev";
const databaseId = String(process.env.CLOUDFLARE_DEV_D1_DATABASE_ID || "").trim();
const workerUrl = String(process.env.CLOUDFLARE_DEV_WORKER_URL || "").trim().replace(/\/+$/, "");

if (!/^[0-9a-f-]{36}$/i.test(databaseId)) throw new Error("CLOUDFLARE_DEV_D1_DATABASE_ID must contain the DEV D1 database UUID.");
if (!workerUrl) throw new Error("CLOUDFLARE_DEV_WORKER_URL is required.");
const parsedWorkerUrl = new URL(workerUrl);
if (parsedWorkerUrl.protocol !== "https:" || !parsedWorkerUrl.hostname.startsWith("yodawy-dashboard-dev.") || !parsedWorkerUrl.hostname.endsWith(".workers.dev") || workerUrl === productionUrl) {
  throw new Error("CLOUDFLARE_DEV_WORKER_URL must be the isolated HTTPS DEV workers.dev URL, not Production.");
}

const validation = spawnSync(process.execPath, [path.join(cloudflareRoot, "scripts", "validate-development.mjs")], { encoding: "utf8" });
if (validation.status !== 0) throw new Error((validation.stderr || validation.stdout || "Development validation failed").trim());

await fs.rm(buildRoot, { recursive: true, force: true });
await fs.mkdir(publicRoot, { recursive: true });
await fs.cp(path.join(cloudflareRoot, "public"), publicRoot, { recursive: true });

const toolsRoot = path.join(repoRoot, "TOOLS");
const legacyRoot = path.join(repoRoot, "LEGACY");
const assetsRoot = path.join(publicRoot, "tools");
const manifestPath = path.join(toolsRoot, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const byFile = new Map(manifest.tools.map(tool => [tool.file, tool]));
const toolFiles = (await fs.readdir(toolsRoot)).filter(file => file.endsWith(".js") && !/^(test-|.*\.(test|spec))/i.test(file)).sort();
if (!toolFiles.length) throw new Error("No official tool source files were found.");
let nextId = manifest.tools.reduce((max, tool) => Math.max(max, Number(String(tool.id).match(/TOOL-(\d+)/)?.[1] || 0)), 0) + 1;
await fs.mkdir(assetsRoot, { recursive: true });

const activeTools = [];
for (const file of toolFiles) {
  const sourcePath = path.join(toolsRoot, file);
  const source = await fs.readFile(sourcePath, "utf8");
  const lines = source.split(/\r?\n/).map(line => line.trim());
  const metadata = tag => {
    const line = lines.find(item => item.startsWith("// @" + tag + " "));
    return line ? line.slice(("// @" + tag).length).trim() : "";
  };
  const name = metadata("name") || path.basename(file, ".js");
  const description = metadata("description");
  const matches = lines.filter(line => line.startsWith("// @match ")).map(line => line.slice(10).trim());
  if (!matches.length) throw new Error(file + " must declare at least one @match pattern.");
  if (/\b(?:odoo|portal)\b/i.test(name)) throw new Error(file + " has a platform-specific tool name.");
  const version = metadata("version");
  if (version && version !== "1") throw new Error(file + " must use @version 1.");

  let tool = byFile.get(file);
  if (!tool) {
    tool = { id: "TOOL-" + String(nextId++).padStart(3, "0"), file, name, description: description || "", enabled: true };
    manifest.tools.push(tool);
    byFile.set(file, tool);
  }

  tool.name = name;
  if (description) tool.description = description;
  tool.matches = matches;
  tool.enabled = true;
  tool.sha256 = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  delete tool.version;
  await fs.copyFile(sourcePath, path.join(assetsRoot, file));
  activeTools.push(tool);
}

const legacyFile = "portal-tool-old.js";
const legacyPath = path.join(legacyRoot, legacyFile);
let legacySha = null;
let legacyMatches = [];
try {
  const legacySource = await fs.readFile(legacyPath, "utf8");
  legacySha = crypto.createHash("sha256").update(legacySource, "utf8").digest("hex");
  legacyMatches = legacySource.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("// @match ")).map(line => line.slice(10).trim());
  if (!legacyMatches.length) throw new Error("PORTAL TOOL OLD must declare at least one @match pattern.");
  await fs.copyFile(legacyPath, path.join(assetsRoot, legacyFile));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const activeFiles = new Set(toolFiles);
for (const tool of manifest.tools) {
  if (!activeFiles.has(tool.file)) tool.enabled = false;
  delete tool.version;
}

const preservedAssets = new Set([...toolFiles, legacyFile]);
for (const file of await fs.readdir(assetsRoot)) {
  if (file.endsWith(".js") && !preservedAssets.has(file)) await fs.unlink(path.join(assetsRoot, file));
}

manifest.tools.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
await fs.writeFile(path.join(buildRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const quote = value => "'" + String(value ?? "").replace(/'/g, "''") + "'";
const statements = activeTools.map(tool =>
  "INSERT INTO tools (tool_id, name, description, version, asset_path, sha256, enabled, match_patterns) VALUES (" +
  [tool.id, tool.name, tool.description, "1", "TOOLS/" + tool.file, tool.sha256, 1, JSON.stringify(tool.matches)].map(quote).join(", ") +
  ") ON CONFLICT(tool_id) DO UPDATE SET name=excluded.name, description=excluded.description, version=excluded.version, asset_path=excluded.asset_path, sha256=excluded.sha256, enabled=1, match_patterns=excluded.match_patterns, updated_at=CURRENT_TIMESTAMP;"
);

if (legacySha) statements.push("UPDATE tools SET sha256=" + quote(legacySha) + ", match_patterns=" + quote(JSON.stringify(legacyMatches)) + ", updated_at=CURRENT_TIMESTAMP WHERE tool_id=" + quote("TOOL-017") + ";");
for (const tool of manifest.tools.filter(item => !item.enabled)) {
  statements.push("UPDATE tools SET enabled=0, updated_at=CURRENT_TIMESTAMP WHERE tool_id=" + quote(tool.id) + ";");
}
for (const tool of activeTools) {
  const visibility = ["TOOL-004", "TOOL-019"].includes(tool.id) ? "PUBLIC" : "PRIVATE";
  statements.push("INSERT OR IGNORE INTO tool_visibility (tool_id, mode, updated_at) VALUES (" + quote(tool.id) + ", " + quote(visibility) + ", CURRENT_TIMESTAMP);");
  if (tool.id === "TOOL-019") statements.push("UPDATE tool_visibility SET mode='PUBLIC', updated_at=CURRENT_TIMESTAMP WHERE tool_id='TOOL-019';");
}
await fs.writeFile(path.join(buildRoot, "sync-tools.sql"), statements.join("\n") + "\n");

let replacements = 0;
const patchAssets = async directory => {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await patchAssets(target);
      continue;
    }
    if (!/\.(js|html|json|css)$/i.test(entry.name)) continue;
    const source = await fs.readFile(target, "utf8");
    const count = source.split(productionUrl).length - 1;
    if (count) {
      replacements += count;
      await fs.writeFile(target, source.split(productionUrl).join(workerUrl));
    }
  }
};
await patchAssets(publicRoot);

for (const relative of ["runtime-config.js", "cloud-bootstrap.js"]) {
  const target = path.join(publicRoot, relative);
  const source = await fs.readFile(target, "utf8");
  if (source.includes(productionUrl) || !source.includes(workerUrl)) throw new Error(relative + " was not isolated from the Production Worker.");
}

const runtimeConfigPath = path.join(publicRoot, "runtime-config.js");
let runtimeConfig = await fs.readFile(runtimeConfigPath, "utf8");
if (!runtimeConfig.includes("VERSION: 1")) throw new Error("Could not mark the DEV runtime configuration.");
runtimeConfig = runtimeConfig.replace("VERSION: 1", "ENVIRONMENT: 'DEVELOPMENT',\n        VERSION: 1");
await fs.writeFile(runtimeConfigPath, runtimeConfig);

const banner = '<div id="yodawy-dev-mode-banner" style="position:fixed;z-index:2147483647;top:8px;right:8px;padding:7px 12px;border-radius:7px;background:#7c2d12;color:#fff;font:700 12px Arial,sans-serif;letter-spacing:.3px;box-shadow:0 2px 8px #0005">YODAWY DEVELOPMENT · TEST ENVIRONMENT</div>';
const indexPath = path.join(publicRoot, "index.html");
let html = await fs.readFile(indexPath, "utf8");
if (!html.includes("yodawy-dev-mode-banner")) {
  if (!/<body\b[^>]*>/i.test(html)) throw new Error("Could not inject the DEV environment indicator into index.html.");
  html = html.replace(/<body\b[^>]*>/i, match => match + banner);
}
await fs.writeFile(indexPath, html);

const bootstrapPath = path.join(publicRoot, "cloud-bootstrap.js");
let bootstrap = await fs.readFile(bootstrapPath, "utf8");
const pageBanner = '(()=>{try{const d=PAGE?.document;if(!d?.body||d.getElementById("yodawy-dev-mode-banner"))return;const e=d.createElement("div");e.id="yodawy-dev-mode-banner";e.textContent="YODAWY DEVELOPMENT · TEST ENVIRONMENT";e.style.cssText="position:fixed;z-index:2147483647;top:8px;right:8px;padding:7px 12px;border-radius:7px;background:#7c2d12;color:#fff;font:700 12px Arial,sans-serif;letter-spacing:.3px;box-shadow:0 2px 8px #0005";d.body.append(e)}catch{}})();\n';
await fs.writeFile(bootstrapPath, pageBanner + bootstrap);

const loaderSource = await fs.readFile(path.join(cloudflareRoot, "tampermonkey-loader.js"), "utf8");
let devLoader = loaderSource
  .replace(/\/\/ @name\s+YODAWY CLOUD LOADER/, "// @name         YODAWY DEVELOPMENT CLOUD LOADER")
  .replace(/\/\/ @connect\s+yodawy-dashboard\.m-saleh-yodawy\.workers\.dev/, "// @connect      " + parsedWorkerUrl.hostname)
  .split(productionUrl).join(workerUrl);
if (devLoader.includes(productionUrl) || !devLoader.includes(workerUrl)) throw new Error("Failed to isolate the DEV Tampermonkey loader.");
await fs.writeFile(path.join(publicRoot, "yodawy-dev-loader.user.js"), devLoader);

const template = await fs.readFile(path.join(cloudflareRoot, "wrangler.development.template.jsonc"), "utf8");
if (!template.includes("__DEV_D1_DATABASE_ID__")) throw new Error("Development Wrangler template is missing the D1 placeholder.");
const generatedConfig = template.replace("__DEV_D1_DATABASE_ID__", databaseId).replace("__DEV_ALLOWED_ORIGINS__", parsedWorkerUrl.origin);
await fs.writeFile(path.join(cloudflareRoot, "wrangler.development.generated.jsonc"), generatedConfig);

process.stdout.write("Prepared isolated DEV Worker assets and configuration.\n");
process.stdout.write("Worker: " + workerUrl + "\n");
process.stdout.write("DEV D1: yodawy-dashboard-dev (" + databaseId + ")\n");
process.stdout.write("Production URL rewrites: " + replacements + "\n");
process.stdout.write("DEV userscript: " + workerUrl + "/yodawy-dev-loader.user.js\n");
