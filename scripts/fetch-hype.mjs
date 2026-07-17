// Generates pre-match hype blurbs (with owner banter) via OpenRouter, writes hype.json.
// Each fixture is written up once — existing entries are kept, only new fixtures
// hit the LLM. Fails soft: any error leaves hype.json untouched and exits 0 so
// the workflow's odds/results steps still land.
import { readFileSync, writeFileSync } from "node:fs";

const ODDS_KEY = process.env.ODDS_API_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const FORCE_REGEN = process.argv.includes("--force");
if (!ODDS_KEY || !OR_KEY) { console.log("keys not set, skipping hype"); process.exit(0); }

const IDS = {
  France: "FRA", Spain: "ESP", Argentina: "ARG", England: "ENG",
  Norway: "NOR", Morocco: "MAR", Belgium: "BEL", Switzerland: "SUI",
};
const NAMES = Object.fromEntries(Object.entries(IDS).map(([n, id]) => [id, n]));

const OWNERS = {
  BEL: "Darley — all he cares about is money, never stops reminding people he lives in London, constantly gawking at girls",
  MAR: "Dom — smokes weed all the time, devastated to be leaving Aberdeen now he's graduated, big video gamer, only recently decided he likes football",
  NOR: "Todd — always playing the guitar, teaching assistant at St Mary's, a rough secondary school",
  SUI: "Perez — activity instructor for kids, wants to buy a house in Sheffield despite never having been, spent his childhood sat under a desk watching YouTube videos",
  ARG: "Ethan — on benefits, the slowest and most unproductive person you'll ever meet, financing a car he clearly can't afford",
  ESP: "Will — locked in on his PhD, found saving kids on slides in Prague and sacrificing himself in the process, doesn't like football",
  FRA: "Bell — beach lifeguard and makes it his whole personality, spent all of last winter as a hermit indoors doing nothing, obsessed with bugs and insects, doesn't like football",
  ENG: "nobody — England lost the semi, so they're playing for bronze against Bell's France, and the £20 refund is dead",
};

const hypePath = new URL("../hype.json", import.meta.url);
let existing = [];
try { existing = JSON.parse(readFileSync(hypePath, "utf8")).hype || []; } catch {}

try {
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/?apiKey=${ODDS_KEY}`);
  if (!res.ok) throw new Error(`Odds API ${res.status}`);
  const now = new Date();
  const fixtures = (await res.json())
    .map(e => ({ home: IDS[e.home_team], away: IDS[e.away_team], start: e.commence_time }))
    .filter(f => f.home && f.away && new Date(f.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  const covered = f => existing.some(e =>
    (e.home === f.home && e.away === f.away) || (e.home === f.away && e.away === f.home));
  const soonest = fixtures.find(f => !covered(f));
  if (!soonest && !FORCE_REGEN) { console.log("no new fixtures to hype"); process.exit(0); }
  const todo = FORCE_REGEN && existing.length ? [existing[0]] : [soonest].filter(Boolean);
  if (!todo.length) { console.log("no fixtures available"); process.exit(0); }

  const fixtureLines = todo.map(f =>
    `- ${NAMES[f.home]} (owned by ${OWNERS[f.home]}) vs ${NAMES[f.away]} (owned by ${OWNERS[f.away]})`).join("\n");

  // free models only (zero-credit key); they rate-limit often, so try several —
  // a fully failed run just retries at the next scheduled workflow
  const MODELS = [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "tencent/hy3:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "openrouter/free",
  ];
  const content =
`Seven mates run a World Cup sweepstake: each was randomly drawn a team, winner takes the £140 pot. Write a hype blurb for each upcoming fixture below.

Fixtures:
${fixtureLines}

Rules for each blurb:
- 2-3 sentences, proper English lads' group-chat banter: dry, specific and merciless but affectionate underneath — mates rinsing each other in the pub, NOT American trash talk. British slang use encouraged.
- Hype the match AND take the piss out of both owners using their personal details. The joke should land on the owner, not just the team.
- Refer to owners by name. If a team is owned by "nobody" (England), roast England as playing for bronze after losing the semi—all the pain, none of the refund.
- No slurs, nothing about protected traits — punch at the lifestyle details given.
- ONLY reference the people, facts and details given above. Never invent names, past sweepstakes, previous events, or anything not stated — no fictional mates, no made-up history.

Reply with STRICT JSON only, no markdown fences: [{"home":"XXX","away":"XXX","text":"..."}] using the 3-letter codes ${todo.map(f => `${f.home}/${f.away}`).join(", ")}.`;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let fresh = null, lastErr = null;
  outer: for (let attempt = 0; attempt < 4; attempt++) {
    for (const model of MODELS) {
      try {
        const llm = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${OR_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 8000, reasoning: { enabled: false }, messages: [{ role: "user", content }] }),
        });
        const data = await llm.json();
        if (!data.choices) throw new Error(JSON.stringify(data.error || data));
        const raw = data.choices[0].message.content.replace(/^```(json)?|```$/gm, "").trim();
        let parsed = JSON.parse(raw).filter(e => e.home && e.away && e.text);
        // filter parsed to only entries whose home/away pair matches a todo fixture in either orientation
        const todoPairs = new Set(todo.map(f => `${f.home}/${f.away}`).concat(todo.map(f => `${f.away}/${f.home}`)));
        fresh = parsed.filter(e => todoPairs.has(`${e.home}/${e.away}`));
        if (fresh.length) { console.log(`generated via ${model} (attempt ${attempt + 1})`); break outer; }
        throw new Error("empty/invalid blurb list");
      } catch (err) { lastErr = err; console.log(`${model} failed: ${err.message}`); }
    }
    let wait = 30;
    try { wait = (JSON.parse(lastErr?.message)?.metadata?.retry_after_seconds ?? 25) + 5; } catch {}
    if (attempt < 3) { console.log(`retrying in ${wait}s…`); await sleep(wait * 1000); }
  }

  if (!fresh || !fresh.length) throw lastErr || new Error("all models failed");

  const updated = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date()).replace(" am", "am").replace(" pm", "pm");

  const newHype = FORCE_REGEN 
    ? fresh 
    : [...existing, ...fresh];
  writeFileSync(hypePath, JSON.stringify({ updated, hype: newHype }, null, 2) + "\n");
  console.log(`wrote hype.json: ${fresh.length} new blurb(s)`);
} catch (err) {
  console.log(`hype generation skipped: ${err.message}`);
  process.exit(0);
}
