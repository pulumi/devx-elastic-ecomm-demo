#!/usr/bin/env -S npx tsx
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateOffline, generateWithClaude } from "./generate.js";
import { parseCatalogue, type Product } from "./products.js";

const USAGE = `shopfront-content <command> [options]

Commands
  list                         Show the current catalogue
  seed                         Replace the catalogue with packages/contracts/seed-data/products.json
  import <file.json>           Upsert products from a JSON file (add --replace to replace everything)
  export [file.json]           Write the catalogue to a file (or stdout)
  generate                     Create products (Claude if ANTHROPIC_API_KEY is set, else offline templates)
      --count <n>              How many (default 24)
      --theme <text>           What the shop sells (default "home goods and small gifts")
      --dry-run                Print instead of uploading
  clear                        Delete every product

Target (first match wins)
  --target / SHOP_URL          Shop base URL
  --key / INTERNAL_API_KEY     Internal API key
  otherwise both are read from \`pulumi stack output\` in infra/pulumi
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    key: { type: "string" },
    stack: { type: "string" },
    replace: { type: "boolean", default: false },
    count: { type: "string", default: "24" },
    theme: { type: "string", default: "home goods and small gifts" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, arg] = positionals;
if (!command || values.help) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function stackOutput(name: string, secret = false): string | undefined {
  try {
    const args = ["stack", "output", name, "-C", join(repoRoot, "infra/pulumi"), ...(values.stack ? ["-s", values.stack] : []), ...(secret ? ["--show-secrets"] : [])];
    return execFileSync("pulumi", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function connection() {
  const target = values.target ?? process.env.SHOP_URL ?? stackOutput("shopUrl");
  const key = values.key ?? process.env.INTERNAL_API_KEY ?? stackOutput("internalApiKeyValue", true);
  if (!target || !key) {
    console.error("Could not work out the shop URL and internal key. Pass --target and --key, or run `pulumi up` first.");
    process.exit(2);
  }
  return { target: target.replace(/\/$/, ""), key };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { target, key } = connection();
  const res = await fetch(`${target}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const money = (c: number, cur = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(c / 100);

function printTable(products: Product[]) {
  for (const p of products) {
    console.log(`  ${(p.id ?? "").padEnd(14)} ${p.sku.padEnd(16)} ${money(p.priceCents, p.currency).padStart(9)}  ${String(p.inventoryCount ?? 0).padStart(4)} in stock  ${p.name}`);
  }
  console.log(`  ${products.length} products`);
}

async function upload(products: Product[], replace: boolean) {
  const res = await call<{ written: number; total: number }>("POST", "/internal/products/bulk", { products, replace });
  console.log(`✓ wrote ${res.written} products${replace ? " (catalogue replaced)" : ""} — catalogue now has ${res.total}`);
}

switch (command) {
  case "list":
    printTable(await call<Product[]>("GET", "/internal/products"));
    break;

  case "seed": {
    const products = parseCatalogue(readFileSync(join(repoRoot, "packages/contracts/seed-data/products.json"), "utf-8"));
    await upload(products, true);
    break;
  }

  case "import": {
    if (!arg) throw new Error("import needs a file path");
    await upload(parseCatalogue(readFileSync(arg, "utf-8")), values.replace);
    break;
  }

  case "export": {
    const products = await call<Product[]>("GET", "/internal/products");
    const json = JSON.stringify(products, null, 2) + "\n";
    if (arg) {
      writeFileSync(arg, json);
      console.log(`✓ exported ${products.length} products to ${arg}`);
    } else process.stdout.write(json);
    break;
  }

  case "generate": {
    const count = Number(values.count);
    const useClaude = !!process.env.ANTHROPIC_API_KEY;
    console.log(`Generating ${count} products for "${values.theme}" ${useClaude ? "with Claude" : "from offline templates (set ANTHROPIC_API_KEY to use Claude)"}…`);
    const products = useClaude ? await generateWithClaude(process.env.ANTHROPIC_API_KEY!, count, values.theme!) : generateOffline(count);
    printTable(products);
    if (values["dry-run"]) break;
    await upload(products, values.replace);
    break;
  }

  case "clear": {
    const res = await call<{ total: number }>("POST", "/internal/products/bulk", { products: [], replace: true });
    console.log(`✓ catalogue cleared (${res.total} products)`);
    break;
  }

  default:
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exit(1);
}
