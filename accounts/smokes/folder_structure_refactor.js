// ==== EDIT HERE ====
const BASE_URL = process.env.BASE_URL || "http://localhost:8000";

const DB = {
  host:     process.env.DATABASE_HOST     || "localhost",
  port:     Number(process.env.DATABASE_PORT)    || 5432,
  user:     process.env.DATABASE_USER     || "postgres",
  password: process.env.DATABASE_PASSWORD || "postgres",
  database: process.env.DATABASE_NAME     || "ledgerlab",
};

const USERS            = 100;    // virtual users running in parallel
const DURATION_SECONDS = 60;    // primary stop condition: how long the load runs
const ITERATIONS       = 0;     // secondary cap per user (0 = time-only)
const RAMP_MS          = 150;   // ms between each user start

const WEIGHTS = {
  health:     20,   // GET /health                        — health probe (hot read)
  send:       68,   // POST /money/send                         — transfer (dominant write)
  createAcct: 10,   // POST /accounts                     — account creation
  deactivate: 2,   // PATCH /accounts/:id/deactivate     — low-frequency action
};

const SEED_LIMIT       = 30;    // max real rows pulled from local DB
const LOG_EACH_REQUEST = true;  // set false for heartbeat-only on heavy runs
// ==== END EDIT ====

const { URL }  = require("url");
const { Pool } = require("pg");
const crypto   = require("crypto");

// ---- local-only guard ----
function assertLocal(label, urlStr) {
  const host = new URL(urlStr).hostname;
  if (!["localhost", "127.0.0.1"].includes(host) && !host.endsWith(".local")) {
    console.error(`[ABORT] ${label} must point to localhost. Got: ${urlStr}`);
    process.exit(1);
  }
}

assertLocal("BASE_URL", BASE_URL);

const HEADERS = { "Content-Type": "application/json" };

// ---- helpers ----
function uuid()          { return crypto.randomUUID(); }
function now()           { return Date.now(); }
function ts(start)       { return ((now() - start) / 1000).toFixed(1) + "s"; }
function p(arr, q)       { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * q)] || 0; }
function pct(n, d)       { return d ? ((n / d) * 100).toFixed(1) : "0.0"; }

function weightedPick(weights) {
  const keys  = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let r = Math.random() * total;
  for (const k of keys) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

// ---- seed (excluded from traffic metrics) ----
async function seed() {
  const pool = new Pool(DB);
  let active = [], deactivated = [];
  try {
    const r1 = await pool.query(
      `SELECT id, balance FROM accounts WHERE deactivated_at IS NULL AND balance > 0 LIMIT $1`,
      [SEED_LIMIT]
    );
    active = r1.rows;

    const r2 = await pool.query(
      `SELECT id FROM accounts WHERE deactivated_at IS NOT NULL LIMIT $1`,
      [SEED_LIMIT]
    );
    deactivated = r2.rows;

    console.log(`[SEED] Active (balance>0): ${active.length}  Already-deactivated: ${deactivated.length}`);
    if (active.length < 2) {
      console.warn("[SEED] Fewer than 2 active accounts with balance — send requests will use accounts created during the run.");
    }
  } catch (err) {
    console.warn(`[SEED] DB unreachable: ${err.message}. Falling back to placeholders — some requests may 400.`);
  } finally {
    await pool.end();
  }
  return { active, deactivated };
}

// ---- request executors ----
async function doHealth() {
  const t0  = now();
  const res = await fetch(`${BASE_URL}/health`);
  const body = await res.text();
  return { ok: res.ok, status: res.status, ms: now() - t0, endpoint: "GET /health", body };
}

const NAMES = ["Alice","Bob","Carol","Dave","Eve","Frank","Grace","Hiro","Ivy","Jack","Kai","Lee","Mia","Noa"];

async function doCreateAccount(state) {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)] + "_" + uuid().slice(0, 6);
  const balance = 100 + Math.floor(Math.random() * 400);
  const t0  = now();
  const res = await fetch(`${BASE_URL}/accounts`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name, currency: "BRL", balance }),
  });
  const ms   = now() - t0;
  const ok   = res.status === 201;
  const body = await res.text();
  if (ok) {
    try {
      const j = JSON.parse(body);
      state.active.push({ id: j.id, balance: Number(j.balance) });
    } catch { /* leave body as-is for logging */ }
  }
  return { ok, status: res.status, ms, endpoint: "POST /accounts", body };
}

async function doSend(state) {
  const pool = state.active;
  if (pool.length < 2) {
    return { ok: false, status: 0, ms: 0, endpoint: "POST /money/send", skipped: true };
  }
  let i1 = Math.floor(Math.random() * pool.length);
  let i2 = Math.floor(Math.random() * (pool.length - 1));
  if (i2 >= i1) i2++;
  const sender   = pool[i1];
  const receiver = pool[i2];
  const amount   = Math.min(1, Number(sender.balance));
  if (amount <= 0) return { ok: false, status: 0, ms: 0, endpoint: "POST /money/send", skipped: true };

  const t0  = now();
  const res = await fetch(`${BASE_URL}/money/send`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      idempotency_key: uuid(),
      sender_id:       sender.id,
      receiver_id:     receiver.id,
      amount: amount * 100,
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, ms: now() - t0, endpoint: "POST /money/send", body };
}

async function doDeactivate(state) {
  // 25% chance: hit an already-deactivated account (exercises 409)
  if (Math.random() < 0.25 && state.deactivated.length > 0) {
    const id  = state.deactivated[Math.floor(Math.random() * state.deactivated.length)];
    const t0  = now();
    const res = await fetch(`${BASE_URL}/accounts/${id}/deactivate`, { method: "PATCH" });
    const body = await res.text();
    const ok = res.status === 200 || res.status === 409;
    return { ok, status: res.status, ms: now() - t0, endpoint: "PATCH /accounts/:id/deactivate", body };
  }

  if (state.active.length === 0) {
    return { ok: false, status: 0, ms: 0, endpoint: "PATCH /accounts/:id/deactivate", skipped: true };
  }

  const idx  = Math.floor(Math.random() * state.active.length);
  const acct = state.active.splice(idx, 1)[0];

  const t0  = now();
  const res = await fetch(`${BASE_URL}/accounts/${acct.id}/deactivate`, { method: "PATCH" });
  const body = await res.text();
  const ok = res.status === 200 || res.status === 409;
  if (ok) state.deactivated.push(acct.id);
  return { ok, status: res.status, ms: now() - t0, endpoint: "PATCH /accounts/:id/deactivate", body };
}

// ---- per-user runner ----
async function runUser(userId, seededActive, seededDeactivated, deadline, logLine) {
  const state = {
    active:      [...seededActive],
    deactivated: [...seededDeactivated.map(r => r.id)],
  };

  const results = [];
  let iter = 0;

  while (now() < deadline && (ITERATIONS === 0 || iter < ITERATIONS)) {
    const pick = weightedPick(WEIGHTS);
    let result;
    try {
      if      (pick === "health")     result = await doHealth();
      else if (pick === "createAcct") result = await doCreateAccount(state);
      else if (pick === "send")       result = await doSend(state);
      else                            result = await doDeactivate(state);
    } catch (err) {
      result = { ok: false, status: 0, ms: 0, endpoint: pick, error: err.message };
    }
    results.push(result);
    logLine(userId, result);
    iter++;
  }

  return results;
}

// ---- result classification ----
// pass       : ok
// bizFail    : expected business rejection (4xx, e.g. insufficient balance 400)
// serverError: real failure (5xx, or status 0 = network/exception)
function classify(r) {
  if (r.ok) return "pass";
  if (r.status >= 400 && r.status < 500) return "bizFail";
  return "serverError";
}

// ---- report ----
function report(allResults, elapsed) {
  const valid     = allResults.filter(r => !r.skipped);
  const total     = valid.length;
  const passed    = valid.filter(r => classify(r) === "pass").length;
  const bizFails  = valid.filter(r => classify(r) === "bizFail").length;
  const srvErrors = valid.filter(r => classify(r) === "serverError").length;
  const latencies = valid.filter(r => r.ms > 0).map(r => r.ms);
  const rps       = total > 0 ? (total / elapsed).toFixed(2) : "0";

  const byEp = {};
  for (const r of valid) {
    if (!byEp[r.endpoint]) byEp[r.endpoint] = { count: 0, ok: 0, biz: 0, err: 0, ms: [] };
    const cls = classify(r);
    byEp[r.endpoint].count++;
    if (cls === "pass") byEp[r.endpoint].ok++;
    else if (cls === "bizFail") byEp[r.endpoint].biz++;
    else byEp[r.endpoint].err++;
    if (r.ms > 0) byEp[r.endpoint].ms.push(r.ms);
  }

  console.log("\n========== SMOKE RESULTS ==========");
  console.log(`Duration: ${elapsed.toFixed(1)}s  |  Total: ${total}  |  Pass: ${passed}  |  BizFail(4xx): ${bizFails}  |  ServerError(5xx/net): ${srvErrors}`);
  console.log(`Latency:  p50=${p(latencies, 0.5)}ms  p95=${p(latencies, 0.95)}ms  p99=${p(latencies, 0.99)}ms`);
  console.log(`Throughput: ${rps} req/s`);
  console.log("\nPer-endpoint breakdown:");

  for (const [ep, d] of Object.entries(byEp)) {
    console.log(
      `  ${ep.padEnd(38)} count=${String(d.count).padStart(4)} (${pct(d.count, total).padStart(5)}%)` +
      `  ok=${d.ok}  biz=${d.biz}  err=${d.err}  p50=${p(d.ms, 0.5)}ms  p95=${p(d.ms, 0.95)}ms  p99=${p(d.ms, 0.99)}ms`
    );
  }

  const bizSamples = valid.filter(r => classify(r) === "bizFail").slice(0, 5);
  if (bizSamples.length) {
    console.log("\nBusiness-failure samples (expected, first 5):");
    for (const e of bizSamples) {
      const msg = e.body ? ` ${String(e.body).replace(/\s+/g, " ").trim()}` : "";
      console.log(`  ${e.endpoint} → status=${e.status}${msg}`);
    }
  }

  const srvSamples = valid.filter(r => classify(r) === "serverError").slice(0, 5);
  if (srvSamples.length) {
    console.log("\nServer-error samples (first 5):");
    for (const e of srvSamples) {
      console.log(`  ${e.endpoint} → status=${e.status}${e.error ? " err=" + e.error : ""}`);
    }
  }

  console.log("====================================\n");
  // Only real server errors fail the run; business rejections are expected under load.
  return srvErrors > 0 ? 1 : 0;
}

// ---- main ----
async function main() {
  console.log(`[SMOKE] ledger-lab folder-structure  BASE=${BASE_URL}  USERS=${USERS}  DURATION=${DURATION_SECONDS}s`);

  try {
    const h = await doHealth();
    if (!h.ok) { console.error("[ABORT] Server health check failed."); process.exit(1); }
    console.log(`[SMOKE] Server healthy (${h.ms}ms). Seeding...`);
  } catch (err) {
    console.error(`[ABORT] Cannot reach ${BASE_URL}/health: ${err.message}`);
    process.exit(1);
  }

  const { active: seededActive, deactivated: seededDeactivated } = await seed();

  const trafficStart = now();
  const deadline     = trafficStart + DURATION_SECONDS * 1000;

  let totalReqs = 0, totalPass = 0, totalFail = 0, lastHb = trafficStart;

  function logLine(userId, result) {
    totalReqs++;
    if (result.skipped) return;
    if (result.ok) totalPass++; else totalFail++;

    if (LOG_EACH_REQUEST) {
      const flag = result.ok ? "ok" : "FAIL";
      const body = result.body ? ` ${String(result.body).replace(/\s+/g, " ").trim()}` : "";
      console.log(
        `[t+${ts(trafficStart)}] u${String(userId).padStart(2)} ${result.endpoint.padEnd(38)} ${result.status} ${result.ms}ms ${flag}${body}`
      );
    }

    const t = now();
    if (t - lastHb >= 1000) {
      const elapsed = (t - trafficStart) / 1000;
      const remain  = Math.max(0, DURATION_SECONDS - elapsed).toFixed(0);
      const rps     = (totalReqs / elapsed).toFixed(1);
      console.log(`[HB] elapsed=${elapsed.toFixed(1)}s remaining=${remain}s  reqs=${totalReqs}  pass=${totalPass}  fail=${totalFail}  rps=${rps}`);
      lastHb = t;
    }
  }

  console.log(`[SMOKE] Starting ${USERS} virtual users (ramp ${RAMP_MS}ms each)...`);

  const userPromises = [];
  for (let u = 0; u < USERS; u++) {
    if (RAMP_MS > 0 && u > 0) await new Promise(r => setTimeout(r, RAMP_MS));
    // Ramp (USERS*RAMP_MS) can exceed the run window; stop launching past the
    // deadline so Promise.all resolves and the final report actually prints.
    if (now() >= deadline) break;
    userPromises.push(runUser(u, seededActive, seededDeactivated, deadline, logLine));
  }

  const nested     = await Promise.all(userPromises);
  const allResults = nested.flat();
  const elapsed    = (now() - trafficStart) / 1000;

  const exitCode = report(allResults, elapsed);
  process.exit(exitCode);
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
