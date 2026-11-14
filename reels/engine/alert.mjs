// ALERTS — one email per problem per 20h (same rule as the health bot), via Resend. No key → console only.
import fs from "node:fs"; import { DIR } from "./brain.mjs";
import "../../scripts/mailguard.mjs"; // 11-14: every bot mail goes through the router (urgent now, the rest → inbox + daily digest)
export async function send(alerts, subject = "CRTLAB reels") {
  const F = `${DIR}/alerted.json`, sent = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, "utf8")) : {}, now = new Date().toISOString();
  const fresh = alerts.filter(([k]) => !sent[k] || Date.now() - Date.parse(sent[k]) > 20 * 3.6e6);
  for (const [k, t] of fresh) console.log("ALERT", k, t);
  if (fresh.length && process.env.RESEND_API_KEY && process.env.ALERT_TO) {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject: `${subject}: ${fresh.map(([k]) => k).join(", ")}`.slice(0, 180), text: fresh.map(([, t]) => "• " + t).join("\n\n") }) });
    if (r.ok) for (const [k] of fresh) sent[k] = now;
  }
  fs.writeFileSync(F, JSON.stringify(sent));
}
// level: "urgent" (sent now) · "info" (inbox + daily digest) · "digest" · omitted = the router decides from the subject
export async function mail(subject, text, { level } = {}) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_TO) return console.log(subject + "\n" + text);
  await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM || "CRTLAB bot <hello@crtlab.pro>", to: process.env.ALERT_TO, subject, text, ...(level ? { tags: [{ name: "level", value: level }] } : {}) }) });
}
