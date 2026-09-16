#!/usr/bin/env node
/**
 * tools/fetch-assets.mjs
 *
 * Downloads public-domain paintings from Wikimedia Commons into ./assets and
 * writes assets/manifest.json. Zero dependencies — Node 18+ only.
 *
 *   node fetch-assets.mjs                  # default target counts
 *   node fetch-assets.mjs --faces 94 --stills 46
 *   node fetch-assets.mjs --width 800      # smaller masters
 *   node fetch-assets.mjs --dry            # discover, don't download
 *
 * Commons resizes server-side, so no image library is needed: we just ask for
 * a thumbnail at the width we want and save the bytes.
 *
 * MEASURED SIZES (avg over 12 paintings):
 *    800px → 208 KB      1000px → 391 KB      1400px → 879 KB
 * 1000px is the right master: the game canvas is 620px, but eye harvesting
 * samples at 900px and wants the detail.
 *
 * YIELD: face detection fires on roughly 64% of search results for "portrait
 * painting" (a lot of them are genre scenes with small or profile faces), and
 * blob targeting succeeds on ~88% of still lifes. So over-fetch and let
 * curate.html reject: ~140 downloaded → ~100 usable.
 */

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join } from "node:path";

/* ------------------------------------------------------------------ config */
const API = "https://commons.wikimedia.org/w/api.php";

// Wikimedia BLOCKS generic user agents. Put a real contact here before running.
const UA = "AnomalyGallery-AssetFetcher/1.0 (https://github.com/vikvic/anomaly-gallery)";

const OUT_DIR   = "assets";
const API_DELAY = 1200;   // ms between API calls
const IMG_DELAY = 250;    // ms between image downloads
const MAX_RETRY = 4;

const FACE_QUERIES = [
  "Rembrandt portrait painting", "Johannes Vermeer painting woman",
  "Raphael portrait painting", "Titian portrait painting",
  "Frans Hals portrait painting", "Diego Velazquez portrait painting",
  "Anthony van Dyck portrait painting", "Hans Holbein portrait painting",
  "Thomas Gainsborough portrait painting", "Francisco Goya portrait painting",
  "Bronzino portrait painting", "El Greco portrait painting",
  "Peter Paul Rubens portrait painting", "Ingres portrait painting",
  "Joshua Reynolds portrait painting", "Jean-Baptiste Greuze portrait",
  "Anton Raphael Mengs portrait painting", "Pompeo Batoni portrait painting"
];
const STILL_QUERIES = [
  "Dutch golden age still life fruit painting", "Willem Kalf still life painting",
  "Pieter Claesz still life painting", "Jan Davidsz de Heem still life painting",
  "Willem Claeszoon Heda still life banquet", "Chardin still life painting",
  "Frans Snyders still life game", "Ambrosius Bosschaert flower still life",
  "Rachel Ruysch flower painting", "Caravaggio still life fruit basket",
  "Juan Sanchez Cotan still life", "Osias Beert still life",
  "Balthasar van der Ast still life fruit", "Abraham van Beyeren still life",
  "Jan van Huysum flower still life", "Floris van Dyck still life"
];

/* ------------------------------------------------------------------- args */
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const WANT_FACES  = +flag("faces", 94);
const WANT_STILLS = +flag("stills", 46);
const WIDTH       = +flag("width", 1000);
const DRY         = args.includes("--dry");

/* ----------------------------------------------------------------- helpers */
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function apiGet(params, attempt = 0) {
  const url = API + "?" + new URLSearchParams({ format: "json", ...params });
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
    const txt = await res.text();
    if (!txt.trimStart().startsWith("{")) throw new Error("non-JSON (rate limited)");
    return JSON.parse(txt);
  } catch (err) {
    if (attempt >= MAX_RETRY) throw err;
    const back = API_DELAY * Math.pow(2, attempt);
    console.warn(`  … ${err.message}; backing off ${back}ms`);
    await sleep(back);
    return apiGet(params, attempt + 1);
  }
}

/* Commons extmetadata carries Wikidata statement tails and multi-language
   blocks ("Russian: «Девятый вал»The Ninth Wavetitle QS:P1476,…"). Strip. */
function cleanText(html) {
  let t = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
  t = t.replace(/\s*(title|label|date)\s*QS:.*$/i, "").replace(/\bQS:[^\s]*/g, "");
  const en = t.match(/English:\s*([^:]+?)(?:\s+[A-Z][a-z]+:|$)/);
  if (en) t = en[1];
  else t = t.replace(/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)?:\s*/, "").replace(/«([^»]*)»/g, "").trim();
  return t.replace(/\s{2,}/g, " ").trim().slice(0, 90);
}
const cleanYear = html => {
  const m = String(html || "").replace(/<[^>]*>/g, " ").match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? m[1] : "";
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const exists = p => access(p).then(() => true, () => false);

/* --------------------------------------------------------------- discovery */
async function discover(queries, kind, want) {
  const found = new Map();
  for (const q of queries) {
    if (found.size >= want) break;
    process.stdout.write(`  [${kind}] ${q} … `);
    let j;
    try {
      j = await apiGet({
        action: "query", origin: "*", generator: "search", gsrnamespace: "6",
        gsrlimit: "14", gsrsearch: q,
        prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: String(WIDTH)
      });
    } catch (e) { console.log("failed"); await sleep(API_DELAY); continue; }

    let added = 0;
    for (const p of Object.values(j?.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (!ii || ii.mime !== "image/jpeg" || !ii.thumburl) continue;
      if (ii.width < 700) continue;                      // too small to harvest from
      const md = ii.extmetadata || {};
      const lic = md.LicenseShortName?.value || "";
      if (!/public domain|^pd|cc0/i.test(lic)) continue; // PD / CC0 only
      if (found.has(p.title)) continue;

      const name   = cleanText(md.ObjectName?.value) ||
                     p.title.replace(/^File:/, "").replace(/\.\w+$/, "").replace(/_/g, " ");
      const artist = cleanText(md.Artist?.value) || "Unknown";
      found.set(p.title, {
        id: slug(`${artist}-${name}`) || slug(p.title),
        title: p.title,
        kind,
        name, artist,
        year: cleanYear(md.DateTimeOriginal?.value),
        license: lic,
        credit: cleanText(md.Credit?.value) || "Wikimedia Commons",
        source: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`,
        url: ii.thumburl
      });
      added++;
    }
    console.log(`+${added} (${found.size}/${want})`);
    await sleep(API_DELAY);
  }
  return [...found.values()].slice(0, want);
}

/* ---------------------------------------------------------------- download */
async function download(item) {
  const file = `${item.id}.jpg`;
  const path = join(OUT_DIR, file);
  if (await exists(path)) return { ...item, file, skipped: true };
  const res = await fetch(item.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
  return { ...item, file, bytes: buf.length };
}

/* -------------------------------------------------------------------- main */
(async () => {
  if (UA.includes("YOURNAME")) {
    console.error("\n✗ Edit UA at the top of this file first — Wikimedia blocks generic user agents.\n");
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  console.log(`\nDiscovering (target ${WANT_FACES} portraits + ${WANT_STILLS} still lifes @ ${WIDTH}px)\n`);
  const faces  = await discover(FACE_QUERIES,  "face",  WANT_FACES);
  const stills = await discover(STILL_QUERIES, "still", WANT_STILLS);
  const all = [...faces, ...stills];
  console.log(`\nDiscovered ${all.length} (${faces.length} portraits, ${stills.length} still lifes)`);

  if (DRY) {
    console.log("\n--dry: nothing downloaded.");
    for (const i of all) console.log(`  ${i.kind.padEnd(5)} ${i.artist} — ${i.name}`);
    return;
  }

  console.log(`\nDownloading to ${OUT_DIR}/ …\n`);
  const items = [];
  let bytes = 0, skipped = 0, failed = 0;
  for (const [n, item] of all.entries()) {
    try {
      const r = await download(item);
      if (r.skipped) skipped++; else bytes += r.bytes || 0;
      delete r.url;                       // manifest references the local file
      delete r.skipped;
      delete r.bytes;
      items.push(r);
      process.stdout.write(`\r  ${n + 1}/${all.length}  ${(bytes / 1048576).toFixed(1)} MB   `);
    } catch (e) {
      failed++;
      console.warn(`\n  ✗ ${item.id}: ${e.message}`);
    }
    await sleep(IMG_DELAY);
  }

  const manifest = {
    generated: new Date().toISOString(),
    width: WIDTH,
    note: "Run curate.html to add `usable` and `blob` fields before shipping.",
    items
  };
  await writeFile(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n\n✓ ${items.length} paintings · ${(bytes / 1048576).toFixed(1)} MB new`
            + `${skipped ? ` · ${skipped} already present` : ""}`
            + `${failed ? ` · ${failed} failed` : ""}`);
  console.log(`✓ ${OUT_DIR}/manifest.json`);
  console.log(`\nNext: serve this folder (npx serve .) and open curate.html,`);
  console.log(`      let it analyse, export the enriched manifest over assets/manifest.json.\n`);
})();
