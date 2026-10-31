// shared helpers for the growth bot jobs (Node 20, no dependencies)
import fs from "node:fs";
export const SITE = "https://crtlab.pro";
export const now = () => new Date();
export const month = (d = now()) => d.toISOString().slice(0, 7);
export const append = (file, obj) => { fs.mkdirSync(file.split("/").slice(0, -1).join("/"), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + "\n"); };
export const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
export async function get(url, opts = {}, ms = 25000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms), t0 = Date.now();
  try { const r = await fetch(url, { ...opts, signal: c.signal, redirect: "follow" }); const body = await r.text(); return { status: r.status, body, ms: Date.now() - t0 }; }
  catch (e) { return { status: 0, body: String(e), ms: Date.now() - t0 }; }
  finally { clearTimeout(t); }
}
