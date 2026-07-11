#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function walk(dir, matcher, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git"].includes(entry.name)) continue;
      walk(fullPath, matcher, files);
      continue;
    }
    if (matcher(fullPath)) files.push(fullPath);
  }
  return files;
}

function relative(file) {
  return path.relative(rootDir, file);
}

function lineMatches(file, patterns) {
  const content = fs.readFileSync(file, "utf8");
  return content
    .split(/\r?\n/)
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => patterns.some((pattern) => pattern.test(line)))
    .map(({ line, lineNumber }) => `${relative(file)}:${lineNumber} ${line.trim()}`);
}

const moduleFiles = walk(path.join(rootDir, "src/modules"), (file) => file.endsWith(".js"));
const routeLayerDirectMock = moduleFiles.flatMap((file) => lineMatches(file, [
  /\badminMockApi\b/,
  /\bgetStaticData\s*\(/
]));
const routeLayerExplicitMockFallback = moduleFiles.flatMap((file) => lineMatches(file, [
  /\bdataService\.callMockAdmin\s*\(/
]));

const importServiceFile = path.join(rootDir, "src/services/master-import-service.js");
const importServiceStaticMock = fs.existsSync(importServiceFile)
  ? lineMatches(importServiceFile, [/\bgetStaticData\s*\(/])
  : [];

const dataServiceFile = path.join(rootDir, "src/services/data-service.js");
const dataServiceContent = fs.readFileSync(dataServiceFile, "utf8");
const moduleExportsStart = dataServiceContent.indexOf("module.exports = {");
const moduleExports = moduleExportsStart >= 0 ? dataServiceContent.slice(moduleExportsStart) : "";
const dataServiceMockOnlyExports = moduleExports
  .split(/\r?\n/)
  .map((line, index) => ({ line, lineNumber: dataServiceContent.slice(0, moduleExportsStart).split(/\r?\n/).length + index }))
  .filter(({ line }) => /:\s*mockOnly\s*\(/.test(line))
  .map(({ line, lineNumber }) => `${relative(dataServiceFile)}:${lineNumber} ${line.trim()}`);

const guardedDemoJsonReferences = [
  path.join(rootDir, "src/services/admin-mock-api.js"),
  path.join(rootDir, "database/seeds/001_seed_mock_data.js")
].flatMap((file) => fs.existsSync(file)
  ? lineMatches(file, [/pos-barokah-admin-demo(?:-bak)?\.json/])
  : []);

function printSection(title, rows) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
  if (!rows.length) {
    console.log("OK");
    return;
  }
  rows.forEach((row) => console.log(row));
}

console.log("Audit DATA_MODE=mysql vs demo JSON boundary");
printSection("Route layer direct mock access", routeLayerDirectMock);
printSection("Route layer explicit mock-only fallback", routeLayerExplicitMockFallback);
printSection("Import service static mock access", importServiceStaticMock);
printSection("Data-service mock-only exports", dataServiceMockOnlyExports);
printSection("Guarded demo JSON references", guardedDemoJsonReferences);

const blockingIssues = routeLayerDirectMock.length + importServiceStaticMock.length + dataServiceMockOnlyExports.length;

if (blockingIssues > 0) {
  console.error(`\nFound ${blockingIssues} MySQL boundary issue(s).`);
  console.error("Fix by routing through dataService MySQL implementations or keeping endpoints explicitly mock-only until implemented.");
  process.exitCode = 1;
} else {
  console.log("\nNo MySQL boundary issues found.");
}

if (routeLayerExplicitMockFallback.length > 0) {
  console.warn(
    `\n${routeLayerExplicitMockFallback.length} route reference(s) still call dataService.callMockAdmin(). ` +
      "These do not read/write demo JSON in DATA_MODE=mysql because callMockAdmin throws, " +
      "but the endpoints still need real MySQL implementations before production use."
  );
}
