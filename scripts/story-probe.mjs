// Ad hoc: evaluate expressions in the page (story lane QA).
//   node scripts/story-probe.mjs [port=5356] [cdp=9426] [query] '<expr>' ['<expr>' …]
import { openPage } from "./qa-cdp.mjs";

const [port = "5356", cdp = "9426", query = "seed=1847&weather=clear", ...exprs] = process.argv.slice(2);
const page = await openPage({ port: Number(port), cdp: Number(cdp), query });
for (const e of exprs) {
  if (e.startsWith("sleep:")) {
    await page.sleep(Number(e.slice(6)));
    continue;
  }
  if (e.startsWith("snap:")) {
    await page.snap(e.slice(5));
    console.log("snap", e.slice(5));
    continue;
  }
  try {
    console.log(JSON.stringify(await page.evaluate(e)));
  } catch (err) {
    console.log("ERR", String(err).slice(0, 400));
  }
}
if (page.errors.length) console.log("errors", page.errors.slice(0, 6));
await page.close();
