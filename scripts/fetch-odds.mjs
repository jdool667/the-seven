// Fetches World Cup outright winner odds from The Odds API and writes odds.json.
// Runs in GitHub Actions (see .github/workflows/odds.yml); needs ODDS_API_KEY.
import { writeFileSync } from "node:fs";

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("ODDS_API_KEY not set"); process.exit(1); }

const IDS = {
  France: "FRA", Spain: "ESP", Argentina: "ARG", England: "ENG",
  Norway: "NOR", Morocco: "MAR", Belgium: "BEL", Switzerland: "SUI",
};

async function get(sport, markets) {
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${KEY}&regions=uk&markets=${markets}&oddsFormat=decimal`);
  if (!res.ok) { console.error(`Odds API ${res.status}: ${await res.text()}`); process.exit(1); }
  return res.json();
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const fmt = xs => String(Math.round(median(xs) * 100) / 100);

// outright winner: median decimal price per team across bookmakers
const prices = {};
for (const event of await get("soccer_fifa_world_cup_winner", "outrights")) {
  for (const bookie of event.bookmakers ?? []) {
    for (const market of bookie.markets ?? []) {
      for (const o of market.outcomes ?? []) {
        const id = IDS[o.name];
        if (id && o.price > 1) (prices[id] ??= []).push(o.price);
      }
    }
  }
}
const odds = {};
for (const [id, xs] of Object.entries(prices)) odds[id] = fmt(xs);
if (!Object.keys(odds).length) { console.error("no matching teams in API response"); process.exit(1); }

// per-match win odds (90-minute h2h) for upcoming games between teams we track
const h2h = [];
for (const event of await get("soccer_fifa_world_cup", "h2h")) {
  const home = IDS[event.home_team], away = IDS[event.away_team];
  if (!home || !away) continue;
  const collected = {};
  for (const bookie of event.bookmakers ?? []) {
    for (const market of bookie.markets ?? []) {
      if (market.key !== "h2h") continue;
      for (const o of market.outcomes ?? []) {
        const key = o.name === "Draw" ? "draw" : IDS[o.name];
        if (key && o.price > 1) (collected[key] ??= []).push(o.price);
      }
    }
  }
  if (collected[home] && collected[away]) {
    const entry = { home, away, prices: {} };
    for (const [key, xs] of Object.entries(collected)) entry.prices[key] = fmt(xs);
    h2h.push(entry);
  }
}

const updated = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date()).replace(" am", "am").replace(" pm", "pm");

writeFileSync(new URL("../odds.json", import.meta.url), JSON.stringify({ updated, odds, h2h }, null, 2) + "\n");
console.log("wrote odds.json:", JSON.stringify({ odds, h2h }));
