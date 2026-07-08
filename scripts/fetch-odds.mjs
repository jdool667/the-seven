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

// snap a decimal price to the nearest rung of the standard bookmaker ladder
const LADDER = [
  "1/5","1/4","2/7","3/10","1/3","2/5","4/9","1/2","8/15","4/7","3/5","8/13","4/6","4/5","5/6",
  "1/1","11/10","6/5","5/4","11/8","6/4","13/8","7/4","15/8","2/1","9/4","5/2","11/4","3/1",
  "10/3","7/2","4/1","9/2","5/1","11/2","6/1","13/2","7/1","15/2","8/1","9/1","10/1","11/1",
  "12/1","14/1","16/1","18/1","20/1","25/1","33/1","40/1","50/1","66/1","80/1","100/1","150/1","250/1",
].map(f => { const [n, d] = f.split("/").map(Number); return { f, v: n / d }; });

function toFraction(dec) {
  const v = dec - 1;
  let best = LADDER[0];
  for (const rung of LADDER) if (Math.abs(rung.v - v) < Math.abs(best.v - v)) best = rung;
  return best.f;
}

const odds = {};
for (const [id, xs] of Object.entries(prices)) odds[id] = toFraction(median(xs));
if (!Object.keys(odds).length) { console.error("no matching teams in API response"); process.exit(1); }

const updated = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date()).replace(" am", "am").replace(" pm", "pm");

writeFileSync(new URL("../odds.json", import.meta.url), JSON.stringify({ updated, odds }, null, 2) + "\n");
console.log("wrote odds.json:", JSON.stringify(odds));
