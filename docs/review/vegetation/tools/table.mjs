// node table.mjs base.json [head.json]: markdown tables of the count probe output.
import { readFileSync } from "node:fs";
const read = (f) => {
  const t = readFileSync(f, "utf8");
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
};
const [a, b] = process.argv.slice(2).map(read);
const k = (n) => (n / 1000).toFixed(0) + "k";
const views = Object.keys(a);
if (b) {
  console.log("| view | triangles before | after | Δ | calls before | after |\n|---|---|---|---|---|---|");
  for (const v of views) {
    if (!b[v]) continue;
    const d = ((b[v].triangles / a[v].triangles - 1) * 100).toFixed(1);
    console.log(`| ${v} | ${k(a[v].triangles)} | ${k(b[v].triangles)} | ${d}% | ${a[v].calls} | ${b[v].calls} |`);
  }
}
const names = [...new Set(views.flatMap((v) => [...Object.keys(a[v].parts), ...(b ? Object.keys(b[v]?.parts ?? {}) : [])]))].sort();
console.log("\n| part | " + views.join(" | ") + " |\n|---|" + views.map(() => "---").join("|") + "|");
for (const n of names)
  console.log(`| ${n} | ` + views.map((v) => (b ? `${k(a[v].parts[n] ?? 0)}→${k(b[v]?.parts[n] ?? 0)}` : k(a[v].parts[n] ?? 0))).join(" | ") + " |");
if (!b) {
  console.log("\n| view | triangles | calls |\n|---|---|---|");
  for (const v of views) console.log(`| ${v} | ${k(a[v].triangles)} | ${a[v].calls} |`);
}
