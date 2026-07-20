// Fetches completed World Cup match results from The Odds API and writes results.json.
// A level final score means penalties — the winner is inferred from which team
// appears in a later fixture. Runs in GitHub Actions; needs ODDS_API_KEY.
import { readFileSync, writeFileSync } from "node:fs";

const KEY = process.env.ODDS_API_KEY;
if (!KEY) { console.error("ODDS_API_KEY not set"); process.exit(1); }

const IDS = {
  France: "FRA", Spain: "ESP", Argentina: "ARG", England: "ENG",
  Norway: "NOR", Morocco: "MAR", Belgium: "BEL", Switzerland: "SUI",
};

async function get(path) {
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/${path}`);
  if (!res.ok) { console.log(`Odds API ${res.status} — sport unavailable (tournament settled), keeping existing results.json`); process.exit(0); }
  return res.json();
}

const scores = await get(`scores/?apiKey=${KEY}&daysFrom=3`);
const fixtures = await get(`events/?apiKey=${KEY}`);   // upcoming fixtures; free endpoint

const fetched = [];
for (const m of scores) {
  if (!m.completed || !m.scores) continue;
  const home = IDS[m.home_team], away = IDS[m.away_team];
  if (!home || !away) continue;
  const hs = +m.scores.find(s => s.name === m.home_team)?.score;
  const as = +m.scores.find(s => s.name === m.away_team)?.score;
  if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;

  let winner = hs > as ? home : as > hs ? away : null;
  const pens = !winner;
  if (pens) {
    // knockout draw → decided on penalties; the winner advanced to a later fixture
    // compute each team's latest commence_time in later fixtures (0 if none)
    const later = fixtures.filter(e => new Date(e.commence_time) > new Date(m.commence_time));
    const latestTime = id => {
      const team = IDS[id] || null;
      if (!team) return 0;
      const times = later.filter(e => IDS[e.home_team] === team || IDS[e.away_team] === team)
        .map(e => new Date(e.commence_time).getTime());
      return times.length > 0 ? Math.max(...times) : 0;
    };
    const homeTime = latestTime(m.home_team);
    const awayTime = latestTime(m.away_team);
    if (homeTime > awayTime) winner = home;
    else if (awayTime > homeTime) winner = away;
  }
  if (winner) fetched.push({ home, away, hs, as, winner, pens });
  else console.log(`skipping ${home}–${away}: level score, winner not yet inferable`);
}

// Read existing results and merge: keep any existing result whose team pair isn't in fetched
let existing = [];
try {
  const data = JSON.parse(readFileSync(new URL("../results.json", import.meta.url), "utf8"));
  existing = data.results || [];
} catch {}

const fetchedPairs = new Set(fetched.map(r => `${r.home}/${r.away}`));
const kept = existing.filter(r => !fetchedPairs.has(`${r.home}/${r.away}`));
const results = [...kept, ...fetched];

const updated = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date()).replace(" am", "am").replace(" pm", "pm");

writeFileSync(new URL("../results.json", import.meta.url), JSON.stringify({ updated, results }, null, 2) + "\n");
console.log("wrote results.json:", JSON.stringify(results));
