#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? process.cwd());

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function findPackageManager() {
  if (exists("pnpm-lock.yaml")) return "pnpm";
  if (exists("yarn.lock")) return "yarn";
  if (exists("bun.lock") || exists("bun.lockb")) return "bun";
  if (exists("package-lock.json")) return "npm";
  return null;
}

function detectFramework(dependencies) {
  const names = new Set(Object.keys(dependencies));
  if (names.has("next")) return "next";
  if (names.has("@remix-run/react")) return "remix";
  if (names.has("astro")) return "astro";
  if (names.has("@sveltejs/kit")) return "sveltekit";
  if (names.has("vite")) return names.has("react") ? "vite-react" : "vite";
  if (names.has("react")) return "react";
  return "browser-javascript";
}

function walk(directory, depth = 0) {
  if (depth > 4 || !fs.existsSync(directory)) return [];
  const ignored = new Set([
    ".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules",
  ]);
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...walk(fullPath, depth + 1));
    } else {
      output.push(fullPath);
    }
  }
  return output;
}

const packageFile = path.join(root, "package.json");
const packageJson = readJson(packageFile) ?? {};
const dependencies = {
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
  ...(packageJson.peerDependencies ?? {}),
};
const sdkPackageFile = path.join(root, "node_modules", "@growthcat", "web", "package.json");
const sdkPackage = readJson(sdkPackageFile);
const localFiles = walk(root);
const entryPattern = /(^|\/)(main|index|app|root|layout|providers?)\.(js|jsx|mjs|ts|tsx)$/i;
const candidateEntryFiles = localFiles
  .filter((file) => entryPattern.test(path.relative(root, file)))
  .map((file) => path.relative(root, file))
  .slice(0, 30);
const verificationPriority = ["typecheck", "test", "lint", "check", "build"];
const scripts = packageJson.scripts ?? {};
const packageManager = findPackageManager();
const runPrefix = packageManager === "yarn"
  ? "yarn"
  : packageManager === "bun"
    ? "bun run"
    : packageManager === "pnpm"
      ? "pnpm"
      : "npm run";

const docs = [
  path.join(root, "node_modules", "@growthcat", "web", "README.md"),
  packageJson.name === "@growthcat/web" ? path.join(root, "README.md") : null,
].filter((file) => file && fs.existsSync(file));

const declarationCandidates = [
  path.join(root, "node_modules", "@growthcat", "web", "dist", "index.d.ts"),
  path.join(root, "node_modules", "@growthcat", "web", "dist", "react", "index.d.ts"),
];
if (packageJson.name === "@growthcat/web") {
  declarationCandidates.push(
    path.join(root, "dist", "index.d.ts"),
    path.join(root, "dist", "react", "index.d.ts"),
  );
}
const declarations = declarationCandidates.filter((file) => fs.existsSync(file));

const result = {
  root,
  packageFile: fs.existsSync(packageFile) ? packageFile : null,
  packageManager,
  framework: detectFramework(dependencies),
  growthCat: {
    requestedVersion: dependencies["@growthcat/web"] ?? null,
    installedVersion: sdkPackage?.version ?? (
      packageJson.name === "@growthcat/web" ? packageJson.version ?? null : null
    ),
    installed: Boolean(sdkPackage) || packageJson.name === "@growthcat/web",
  },
  docs,
  declarations,
  candidateEntryFiles,
  environmentExamples: [
    ".env.example", ".env.local.example", ".env.sample", "example.env",
  ].filter(exists),
  verificationCommands: verificationPriority
    .filter((name) => typeof scripts[name] === "string")
    .map((name) => `${runPrefix} ${name}`),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
