#!/usr/bin/env node
// scripts/fix-unicode-escapes.mjs
//
// Some source files were accidentally written with literal backslash-u escape
// sequences as plain text, so the UI and README showed raw codepoints instead
// of Cyrillic. This codemod decodes those sequences back into real UTF-8
// characters, rewriting affected files in place.
//
// Usage:  node scripts/fix-unicode-escapes.mjs [rootDir]   (defaults to ".")
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.argv[2] ?? ".";
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".md", ".html", ".json", ".css"]);
const SKIP = new Set(["node_modules", ".git", "dist", "target", "binaries"]);
const SELF = "fix-unicode-escapes.mjs";

const RE = /\\u([0-9a-fA-F]{4})/g;
let files = 0;
let seqs = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name === SELF) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXTS.has(extname(p))) fix(p);
  }
}

function fix(file) {
  const before = readFileSync(file, "utf8");
  let n = 0;
  const after = before.replace(RE, (_, hex) => {
    n++;
    return String.fromCharCode(parseInt(hex, 16));
  });
  if (n > 0 && after !== before) {
    writeFileSync(file, after, "utf8");
    files++;
    seqs += n;
    console.log("fixed " + file + " (" + n + " escapes)");
  }
}

walk(ROOT);
console.log("");
console.log("Done: decoded " + seqs + " escapes across " + files + " files.");
