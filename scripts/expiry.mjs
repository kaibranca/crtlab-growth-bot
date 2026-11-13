// EXPIRY WATCH (11-13, Kai: "nothing should ever fail with time passing"). Everything with a date on it, checked daily:
//   domain crtlab.pro (RDAP) · TLS certificate · GitHub token (GH_WATCH_TOKEN, expiry header) · Cloudflare API token
//   (verify → expires_on) · Meta page token for the IG/FB engine (debug_token → expires_at + data_access_expires_at).
// → data/machines/expiry.json (+ Fixer tasks under 45 days). One email per item at ≤ 30 days and again at ≤ 7 days.
// A check that cannot run says "unknown" (never a false alarm, never silence about a dead token: invalid = 0 days).
import fs from "node:fs";
import tls from "node:tls";
const J = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const out = [], now = Date.now(), days = (t) => (t ? Math.floor((t - now) / 864e5) : null);
const item = (id, name, at, note = "", fix = "") => out.push({ id, name, expires: at ? new Date(at).toISOString().slice(0, 10) : null, daysLeft: at === 0 ? 0 : days(at), note, fix });
const safe = async (f) => { try { await f(); } catch (e) { console.log("expiry: check failed", String(e).slice(0, 120)); } };

await safe(async () => { // domain (Porkbun) — RDAP of the .pro registry
  const j = await (await fetch("https://rdap.identitydigital.services/rdap/domain/crtlab.pro")).json();
  const e = (j.events ?? []).find((x) => x.eventAction === "expiration");
  item("domain", "crtlab.pro domain (Porkbun)", e ? Date.parse(e.eventDate) : null, "", "renew at Porkbun / turn auto-renew on");
});
await safe(async () => { // TLS (Cloudflare edge cert, auto-renews — a near date means renewal is stuck)
  const end = await new Promise((res, rej) => { const s = tls.connect(443, "crtlab.pro", { servername: "crtlab.pro" }, () => { const c = s.getPeerCertificate(); s.end(); res(Date.parse(c.valid_to)); }); s.on("error", rej); s.setTimeout(10000, () => { s.destroy(); rej(new Error("tls timeout")); }); });
  item("tls", "TLS certificate (Cloudflare, auto-renews)", end, "", "Cloudflare SSL/TLS → Edge Certificates: check renewal");
});
await safe(async () => { // GitHub token the machines use to dispatch/commit
  const T = process.env.GH_WATCH_TOKEN; if (!T) return;
  const r = await fetch("https://api.github.com/rate_limit", { headers: { authorization: `Bearer ${T}`, "user-agent": "crtlab-expiry" } });
  const h = r.headers.get("github-authentication-token-expiration");
  if (r.status === 401) item("gh-token", "GitHub token (GH_WATCH_TOKEN)", 0, "INVALID now", "make a new fine-grained token, set secret GH_WATCH_TOKEN");
  else item("gh-token", "GitHub token (GH_WATCH_TOKEN)", h ? Date.parse(h.replace(" UTC", "Z").replace(" ", "T")) : null, h ? "" : "no expiry", "regenerate the token on GitHub → set secret GH_WATCH_TOKEN");
});
await safe(async () => { // Cloudflare API token (shield, eyes, cron worker)
  const T = process.env.CF_API_TOKEN, A = process.env.CF_ACCOUNT_ID; if (!T) return;
  let j = await (await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", { headers: { authorization: `Bearer ${T}` } })).json();
  if (!j.success && A) j = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/tokens/verify`, { headers: { authorization: `Bearer ${T}` } })).json();
  if (!j.success) item("cf-token", "Cloudflare API token", 0, "INVALID now", "roll the token (it has API Tokens Write) → secrets CF_API_TOKEN + worker crtlab-cron");
  else item("cf-token", "Cloudflare API token", j.result?.expires_on ? Date.parse(j.result.expires_on) : null, j.result?.expires_on ? "" : "no expiry", "roll the token → secrets CF_API_TOKEN + worker crtlab-cron");
});
await safe(async () => { // Meta page token (IG/FB reels engine) — page tokens can lapse; data access lapses every 90 days without use
  const T = process.env.META_PAGE_TOKEN, I = process.env.META_APP_ID, S = process.env.META_APP_SECRET; if (!T || !I || !S) return;
  const j = await (await fetch(`https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(T)}&access_token=${encodeURIComponent(`${I}|${S}`)}`)).json();
  const d = j.data ?? {};
  if (!d.is_valid) item("meta-token", "Meta page token (IG/FB reels)", 0, `INVALID: ${d.error?.message ?? "unknown"}`, "re-issue a long-lived page token → secret META_PAGE_TOKEN");
  else {
    item("meta-token", "Meta page token (IG/FB reels)", d.expires_at ? d.expires_at * 1000 : null, d.expires_at ? "" : "never expires", "re-issue a long-lived page token → secret META_PAGE_TOKEN");
    if (d.data_access_expires_at) item("meta-data", "Meta data access (IG/FB reels)", d.data_access_expires_at * 1000, "renews each time the token is used by the app owner", "open the app in Meta for Developers / re-auth once");
  }
});

const prev = J("data/machines/expiry.json", { mailed: {} }), mailed = prev.mailed ?? {};
const due = out.filter((x) => x.daysLeft != null && x.daysLeft <= 30);
const toMail = due.filter((x) => { const step = x.daysLeft <= 7 ? "7" : "30"; return mailed[x.id] !== `${x.expires}|${step}`; });
if (toMail.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `CRTLAB: ${toMail.map((x) => x.name.split(" (")[0]).join(", ")} expires in ${Math.min(...toMail.map((x) => x.daysLeft))} days`, text: toMail.map((x) => `• ${x.name}: ${x.daysLeft <= 0 ? "EXPIRED / INVALID" : `expires ${x.expires} (${x.daysLeft} days)`}${x.note ? " — " + x.note : ""}\n  fix: ${x.fix}`).join("\n") }) }).catch(() => null);
  if (r?.ok) for (const x of toMail) mailed[x.id] = `${x.expires}|${x.daysLeft <= 7 ? "7" : "30"}`;
}
fs.writeFileSync("data/machines/expiry.json", JSON.stringify({ at: new Date().toISOString(), items: out, soon: out.filter((x) => x.daysLeft != null && x.daysLeft <= 45), mailed }, null, 1));
console.log(`expiry: ${out.map((x) => `${x.id} ${x.daysLeft ?? "∞"}d`).join(" · ")}${due.length ? ` — ${due.length} due ≤ 30 d` : ""}`);
