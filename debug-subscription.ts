/**
 * debug-subscription.ts  – RLS visibility helper
 *
 * • Works with Bun **or** Node
 * • Lets you choose:
 *      (a) email + password  OR
 *      (b) paste an existing JWT from DevTools
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createInterface,
  Interface as ReadlineInterface,
} from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createClient } from "@supabase/supabase-js";

/* ──────────────────────────────────────────
   0. Simple .env loader (no dotenv package)
   ────────────────────────────────────────── */
const ENV_PATH = resolve(process.cwd(), ".env");
if (existsSync(ENV_PATH)) {
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    }
  }
}

/* ──────────────────────────────────────────
   1. Required env vars
   ────────────────────────────────────────── */
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("❌  SUPABASE_URL or SUPABASE_ANON_KEY missing in .env");
  process.exit(1);
}

/* ──────────────────────────────────────────
   2. Readline helpers
   ────────────────────────────────────────── */
function prompt(): ReadlineInterface {
  return createInterface({ input, output });
}

async function askEmailAndPassword() {
  const rl = prompt();
  const email = await rl.question("Email            : ");
  const pwd = await rl.question("Password (hidden): ", { hideEchoBack: true });
  await rl.close();
  return { email, pwd };
}

async function askJwt() {
  const rl = prompt();
  const jwt = await rl.question("Paste JWT (access_token) : ");
  await rl.close();
  return jwt.trim();
}

/* ──────────────────────────────────────────
   3. Menu   – choose sign-in method
   ────────────────────────────────────────── */
const rlMenu = prompt();
const choice = await rlMenu.question(
  "\nChoose auth method:\n" +
    "  1  Email + password (credentials auth)\n" +
    "  2  Paste existing JWT (magic-link / OAuth user)\n" +
    "Select 1 or 2 → "
);
await rlMenu.close();

let jwt: string;
let userId: string;
let supabase = createClient(SUPABASE_URL, ANON_KEY);

if (choice.trim() === "2") {
  /* ---------- JWT paste path ---------- */
  jwt = await askJwt();
  const { data: user, error } = await supabase.auth.getUser(jwt);
  if (error || !user) {
    console.error("❌  JWT invalid or expired. Details:", error?.message);
    process.exit(1);
  }
  userId = user.user.id;
} else {
  /* ---------- e-mail / password path ---------- */
  const { email, pwd } = await askEmailAndPassword();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pwd,
  });
  if (error || !data.session) {
    console.error("❌  Sign-in failed:", error?.message);
    process.exit(1);
  }
  jwt = data.session.access_token;
  userId = data.user.id;
}

/* ──────────────────────────────────────────
   4. Fetch subscriptions with same JWT
   ────────────────────────────────────────── */
console.log("\n✅  Using user_id =", userId);
console.log("JWT first 40 chars:", jwt.slice(0, 40), "...\n");

const url =
  `${SUPABASE_URL}/rest/v1/subscriptions` +
  `?user_id=eq.${userId}` +
  `&select=id,status,current_period_end`;

const res = await fetch(url, {
  headers: {
    apikey: ANON_KEY,
    authorization: `Bearer ${jwt}`,
  },
});

const txt = await res.text();

console.log("HTTP status :", res.status);
console.log("Raw JSON    :", txt);