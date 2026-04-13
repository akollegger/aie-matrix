import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const src = join(pkgRoot, "../../maps/sandbox");
const dest = join(pkgRoot, "public/maps/sandbox");

if (!existsSync(src)) {
  console.error(`copy-map-assets: missing source directory: ${src}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-map-assets: ${src} -> ${dest}`);
