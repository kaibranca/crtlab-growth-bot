// NON-US RELEASE FAMILIES (11-07) — one list for the backfill (TradingView titles), the live news days (ForexFactory titles)
// and the calendar (TradingView titles, by country). `mk` is the pair the release is about: it leads the headline and the page.
//   cur = currency (both feeds), cc = TradingView country code
export const XFAM = [
  { cur: "GBP", cc: "GB", fam: "uk-cpi", name: "UK CPI", mk: "GBPUSD", tv: /^Inflation Rate YoY$/, ff: /^CPI y\/y$/ },
  { cur: "GBP", cc: "GB", fam: "boe", name: "BoE", mk: "GBPUSD", tv: /^(BoE )?Interest Rate( Decision)?$/, ff: /^Official Bank Rate$/ },
  { cur: "GBP", cc: "GB", fam: "uk-jobs", name: "UK Jobs", mk: "GBPUSD", tv: /^Unemployment Rate$/, ff: /^(Claimant Count Change|Unemployment Rate)$/ },
  { cur: "EUR", cc: "EU", fam: "ecb", name: "ECB", mk: "EURUSD", tv: /^ECB Interest Rate Decision$/, ff: /^Main Refinancing Rate$/ },
  { cur: "EUR", cc: "EU", fam: "ez-cpi", name: "Eurozone CPI", mk: "EURUSD", tv: /^Inflation Rate YoY Flash$/, ff: /^CPI Flash Estimate y\/y$/ },
  { cur: "JPY", cc: "JP", fam: "boj", name: "BoJ", mk: "USDJPY", tv: /^(BoJ )?Interest Rate( Decision)?$/, ff: /^BOJ Policy Rate$/ },
  { cur: "AUD", cc: "AU", fam: "rba", name: "RBA", mk: "AUDUSD", tv: /^RBA Interest Rate Decision$/, ff: /^Cash Rate$/ },
  { cur: "AUD", cc: "AU", fam: "au-jobs", name: "Australia Jobs", mk: "AUDUSD", tv: /^Employment Change$/, ff: /^Employment Change$/ },
  { cur: "AUD", cc: "AU", fam: "au-cpi", name: "Australia CPI", mk: "AUDUSD", tv: /^(Quarterly )?Inflation Rate YoY$|^Monthly CPI Indicator$/, ff: /^CPI y\/y$|^CPI q\/q$/ },
];
export const xfamTv = (cur, title) => XFAM.find((f) => f.cur === cur && f.tv.test(title)) ?? null;
export const xfamFf = (cur, title) => XFAM.find((f) => f.cur === cur && f.ff.test(title)) ?? null;
export const famMk = (fams) => XFAM.find((f) => fams.includes(f.fam))?.mk ?? null;
