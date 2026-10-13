// Cloudflare Worker: reads ISD + DETE pages on request, returns the same JSON shape as dates.json.
const ISD = "https://www.irishimmigration.ie/registering-your-immigration-permission/how-to-renew-your-current-permission/renewing-your-registration-permission-if-you-live-in-the-republic-of-ireland/";
const DETE = "https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/current-application-processing-dates/";
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Cache-Control": "public, max-age=300" };
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];

const strip = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const cells = tr => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => strip(m[1]));
const rows = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => cells(m[1]));
const tables = html => [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => rows(m[0]));
const get = async u => {
  const r = await fetch(u, { headers: { "User-Agent": "irp-tracker/1.0 (personal project)" }, cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error(u + " returned " + r.status);
  return r.text();
};
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

async function isd() {
  const html = await get(ISD), text = strip(html);
  const m = text.match(/last updated on (\w+) (\d{1,2}), (\d{4})/i);
  if (!m) throw new Error("ISD 'last updated' not found");
  const pub = iso(m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, m[2]);
  const want = ["1, 1H", "1G", "2, 2A, 1A", "4", "All other categories"], got = {};
  for (const r of rows(html)) {
    const d = r[1] && r[1].match(/^(\d\d)\/(\d\d)\/(\d\d)/);
    if (r.length >= 2 && want.includes(r[0]) && d) got[r[0]] = iso("20" + d[3], d[2], d[1]);
  }
  if (want.some(k => !got[k])) throw new Error("ISD rows found: " + JSON.stringify(got));
  return { pub, items: want.map(k => got[k]) };
}

async function dete() {
  const html = await get(DETE), text = strip(html);
  const p = text.match(/As of (\d{1,2}) (\w+) (\d{4})/i);
  if (!p) throw new Error("DETE 'As of' date not found");
  const pub = iso(p[3], MONTHS.indexOf(p[2].toLowerCase()) + 1, p[1]);
  // order matches the website; ICT is tested before plain Renewal
  const keys = [["Intra-Company Transfer", "(Renewal)", 5], ["Intra-Company Transfer", "(New)", 4], ["Renewal Applications", "", 0],
    ["Critical Skills", "", 1], ["New General Employment", "", 2], ["All other New", "", 3], ["Reviews", "", 6]];
  const out = Array(7).fill(null);
  for (const t of tables(html)) {
    if (t.length < 2 || !t[0][0] || !t[1][0]) continue;
    const head = t[0][0], d = t[1][0].match(/(\d{1,2}) (\w+) (\d{4})/);
    if (!d) continue;
    for (const [a, b, i] of keys) if (head.includes(a) && head.includes(b)) {
      out[i] = iso(d[3], MONTHS.indexOf(d[2].toLowerCase()) + 1, d[1]); break;
    }
  }
  if (out.includes(null)) throw new Error("DETE tables found: " + JSON.stringify(out));
  return { pub, items: out };
}

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      const [a, b] = await Promise.all([isd(), dete()]);
      return new Response(JSON.stringify({ checked: new Date().toISOString().slice(0, 10), live: true, isd: a, dete: b }), { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...CORS, "Cache-Control": "no-store" } });
    }
  }
};
