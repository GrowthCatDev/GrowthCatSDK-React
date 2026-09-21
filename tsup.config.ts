import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  entry: ["src/index.ts", "src/react/index.ts"],
  format: ["cjs", "esm"],
  splitting: true,
  dts: true,
  sourcemap: true,
  clean: true,
  define: { __GROWTHCAT_VERSION__: JSON.stringify(version) },
});
