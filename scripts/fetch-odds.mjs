// Fetches World Cup outright winner odds from The Odds API and writes odds.json.
// Runs in GitHub Actions (see .github/workflows/odds.yml); needs ODDS_API_KEY.
import { writeFileSync } from "node:fs";

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("ODDS_API_KEY not set"); process.exit(1); }

const IDS = {
  France: "FRA", Spain: "ESP", Argentina: "ARG", England: "ENG",
  Norway: "NOR", Morocco: "MAR", Belgium: "BEL", Switzerland: "SUI",
};

const url = `https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup_winner/odds/?apiKey=${KEY}&regions=uk&markets=outrights&oddsFormat=decimal`;
const res = await fetch(url);
if (!res.ok) { console.error(`Odds API ${res.status}: ${await res.text()}`); process.exit(1); }
const events = await res.json();

// median decimal price per team across bookmakers
const prices = {};
for (const event of events) {
  for (const bookie of event.bookmakers ?? []) {
    for (const market of bookie.markets ?? []) {
      for (const o of market.outcomes ?? []) {
        const id = IDS[o.name];
        if (id && o.price > 1) (prices[id] ??= []).push(o.price);
      }
    }
  }
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// nearest tidy fraction for a decimal price (bookmaker style: 2.875 → 15/8)
function toFraction(dec) {
  const v = dec - 1;
  let best = null;
  for (let d = 1; d <= 20; d++) {
    const n = Math.round(v * d);
    if (n < 1) continue;
    const err = Math.abs(n / d - v);
    if (!best || err < best.err - 1e-9) best = { n, d, err };
  }
  return best ? `${best.n}/${best.d}` : `${Math.max(1, Math.round(v))}/1`;
}

const odds = {};
for (const [id, xs] of Object.entries(prices)) odds[id] = toFraction(median(xs));
if (!Object.keys(odds).length) { console.error("no matching teams in API response"); process.exit(1); }

const updated = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date()).replace(" am", "am").replace(" pm", "pm");

writeFileSync(new URL("../odds.json", import.meta.url), JSON.stringify({ updated, odds }, null, 2) + "\n");
console.log("wrote odds.json:", JSON.stringify(odds));
