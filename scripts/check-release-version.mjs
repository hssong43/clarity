// Fails a release build when the tag does not match the app version in
// package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml.
// Usage: node scripts/check-release-version.mjs v0.1.0
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function readVersions(root = new URL("..", import.meta.url)) {
  const read = (path) => readFileSync(new URL(path, root), "utf8");
  const cargoVersion = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  return {
    "package.json": JSON.parse(read("package.json")).version,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
    "src-tauri/Cargo.toml": cargoVersion
  };
}

export function versionMismatches(tag, versions) {
  const expected = tag.replace(/^v/, "");
  return Object.entries(versions)
    .filter(([, version]) => version !== expected)
    .map(([file, version]) => `${file} has ${version ?? "no version"}, tag is ${tag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2];
  if (!tag || !/^v\d+\.\d+\.\d+(-[\w.]+)?$/.test(tag)) {
    console.error(`Expected a tag like v1.2.3, got "${tag ?? ""}"`);
    process.exit(1);
  }
  const problems = versionMismatches(tag, readVersions());
  if (problems.length > 0) {
    console.error(["Release version mismatch:", ...problems].join("\n  "));
    process.exit(1);
  }
  console.log(`Release ${tag} matches the app version.`);
}
