// engine/core/brief-lib.mjs — the DAILY ENGINE BRIEF (11-14). Replaces the v1 LLM analyst (gpt-4.1-mini reading ~33 v1
// files incl. retired theatre, output consumed by nobody, causal claims with no verdict behind them). Deterministic: every
// line comes from a verified v2 file and says where it came from; missing input = "unknown", never a guess. Pure, tested.
const lvl = (x) => (x ?? "unknown").toUpperCase();
export function brief({ drops, learn, jobs, rot, gateRows }) {
  const out = [];
  // 1. north star
  const a = drops?.metrics?.accounts, w7 = a?.windows?.find((w) => w.w === 7);
  out.push(w7 ? `ACCOUNTS (north star): ${w7.observed} in 7 d vs ${w7.expected} normal (×${w7.ratio}) — ${lvl(a.level)}` : "ACCOUNTS: unknown (WATCH did not run)");
  // 2. what moved, and where
  const moved = Object.entries(drops?.metrics ?? {}).filter(([m, r]) => m !== "accounts" && ["drop", "watch", "rise"].includes(r.level));
  for (const [m, r] of moved) {
    const w = r.windows?.find((x) => x.level === r.level) ?? r.windows?.at(-1);
    out.push(`• ${m}: ${lvl(r.level)}${w ? ` (${w.w} d ${w.observed} vs ${w.expected}, ×${w.ratio})` : r.p != null ? ` (p ${r.p})` : ""}`);
    const y = drops?.why?.[m];
    if (y) out.push(`    where: ${[...y.losers.slice(0, 2).map((p) => `↓ ${p.page} ${p.expected}→${p.recent}`), ...y.gainers.slice(0, 1).map((p) => `↑ ${p.page} ${p.expected}→${p.recent}`)].join(" · ")}`);
  }
  if (drops?.google?.length) out.push(`• OUTSIDE: Google ${drops.google.map((e) => `${e.what}${e.end ? "" : " (rolling out)"}`).join(", ")} — Google numbers move for everyone`);
  // 3. learning
  if (learn) {
    const L = learn.learnability ?? {}, last = (learn.groups ?? []).filter((g) => g.final).slice(-2);
    out.push(`LEARN: ${L.groups ?? 0} change group(s), ${L.judged ?? 0} judged, ${L.clean ?? 0} clean${L.share != null ? ` (learnability ${L.share})` : ""}` +
      (learn.grade?.accounts?.graded ? ` · WATCH alarm precision ${learn.grade.accounts.precision} (n=${learn.grade.accounts.graded})` : ""));
    for (const g of last) out.push(`• ${g.day0}→${g.last}: accounts ${lvl(g.state)}${g.clean ? "" : " (confounded)"}`);
  } else out.push("LEARN: unknown");
  // 4. health — only what is NOT ok
  const jf = (jobs?.checks ?? []).filter((c) => c.state !== "ok"), rf = (rot?.checks ?? []).filter((c) => c.state === "fail" || c.state === "warn");
  out.push(jobs ? (jf.length ? `JOBS: ${jf.map((c) => `${c.job} ${c.state}`).join(" · ")}` : "JOBS: all ok") : "JOBS: unknown");
  if (rf.length) out.push(`ROT: ${rf.map((c) => `${c.what} ${c.state}`).join(" · ")}`);
  // 5. gate — machines currently held (latest row per machine)
  const lastBy = {}; for (const r of gateRows ?? []) lastBy[r.machine] = r;
  const held = Object.values(lastBy).filter((r) => !r.allow);
  if (held.length) out.push(`HELD by the gate: ${held.map((r) => r.machine).join(", ")} — ${[...new Set(held.map((r) => r.why.split(":")[0]))].join("; ")}`);
  return out;
}
