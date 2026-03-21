#!/usr/bin/env node
/**
 * Postinstall patch: fix @nomicfoundation/hardhat-ethers allowNull for empty string "to" field.
 *
 * Some mainnet RPC providers return "to": "" (empty string) instead of null for contract
 * deployment transactions. ethers.js v6 is strict and throws on empty-string addresses.
 * The allowNull helper in hardhat-ethers v3.x doesn't handle this case.
 *
 * Fix: also treat "" as null so contract deployments don't crash on mainnet.
 * Upstream issue: https://github.com/NomicFoundation/hardhat/issues
 */

const fs = require("fs");
const path = require("path");

const FILES = [
  "node_modules/@nomicfoundation/hardhat-ethers/internal/ethers-utils.js",
  "node_modules/@nomicfoundation/hardhat-ethers/src/internal/ethers-utils.ts",
];

const OLD = "if (value === null || value === undefined) {";
const NEW = 'if (value === null || value === undefined || value === "") {';

let patched = 0;
for (const rel of FILES) {
  const abs = path.resolve(__dirname, "..", rel);
  if (!fs.existsSync(abs)) continue;

  const src = fs.readFileSync(abs, "utf8");
  if (src.includes(NEW)) {
    console.log(`[postinstall] already patched: ${rel}`);
    continue;
  }
  if (!src.includes(OLD)) {
    console.warn(`[postinstall] unexpected content, skipping: ${rel}`);
    continue;
  }

  fs.writeFileSync(abs, src.replace(OLD, NEW));
  console.log(`[postinstall] patched: ${rel}`);
  patched++;
}

if (patched > 0) {
  console.log(`[postinstall] applied ${patched} patch(es) to hardhat-ethers`);
}
