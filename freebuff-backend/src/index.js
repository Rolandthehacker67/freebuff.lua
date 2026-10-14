// ═════════════════════════════════════════════════════════════════════
//  Freebuff client — backend (Cloudflare Worker, ES modules)
//  Storage: D1 binding `DB` (created via `wrangler d1 create`, see README)
//  Implements docs/API-CONTRACT.md exactly. No fake data leaves this file.
// ═════════════════════════════════════════════════════════════════════
import { FREEBUFF, SESSION_TTL_SEC, LINK_TTL_SEC, WEBSITE_ORIGIN, RATE_LIMIT, POLL_INTERVAL_MS } from "../config.js";

// ── small utils ─────────────────────────────────────────────────────
const enc = new TextEncoder();

function sha256Hex(s) {
	return crypto.subtle.digest("SHA-256", enc.encode(s)).then(b => {
		return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
	});
}
const nowSec = () => Math.floor(Date.now() / 1000);

function jsonResponse(obj, status = 200, extraHeaders = {}) {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
	});
}
function fail(error, message, status = 400, extraHeaders = {}) {
	return jsonResponse({ ok: false, error, message, status }, status, extraHeaders);
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 (human reading)
function randomCode() {
	let out = "";
	const rnd = new Uint32Array(8);
	crypto.getRandomValues(rnd);
	for (let i = 0; i < 8; i++) out += CODE_CHARS[rnd[i] % CODE_CHARS.length];
	return out;
}
function randomToken() {
	const b = new Uint8Array(32);
	crypto.getRandomValues(b);
	return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const hashToken = sha256Hex; // tokens are stored only as SHA-256 hex

// ── rate limiting (per isolate) ─────────────────────────────────────
const buckets = new Map(); // key -> array of epoch-seconds
function rateHit(key, limitPerMin) {
	const now = nowSec();
	let arr = buckets.get(key);
	if (!arr) { arr = []; buckets.set(key, arr); }
	while (arr.length && arr[0] <= now - 60) arr.shift();
	if (arr.length >= limitPerMin) return { limited: true, retryAfter: 60 - (now - arr[0]) };
	arr.push(now);
	return { limited: false, retryAfter: 0 };
}
// buckets are pruned lazily inside rateHit — no global timers (Workers-safe)

// ── request helpers ────────────────────────────────────────────────
async function readJson(req) {
	try { return await req.json(); } catch { return {}; }
}
function clientIp(req) {
	return req.headers.get("cf-connecting-ip") || "unknown";
}

function securityHeaders() {
	return {
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"X-Frame-Options": "DENY",
		"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
	};
}

function corsHeaders(req) {
	// locked to the configured website origin; localhost variants allowed for dev
	const origin = req.headers.get("origin") || "";
	const allowed = !WEBSITE_ORIGIN || origin === WEBSITE_ORIGIN ||
		/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
	return {
		"Access-Control-Allow-Origin": allowed && origin ? origin : WEBSITE_ORIGIN || "",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token, X-Requested-With",
		"Access-Control-Max-Age": "600",
		...securityHeaders(),
	};
}

// ── D1 schema (lazy, idempotent) ────────────────────────────────────
let schemaReady = null;
async function ensureSchema(env) {
	if (!schemaReady) {
		schemaReady = env.DB.batch([
			env.DB.prepare(
				`CREATE TABLE IF NOT EXISTS link_codes (
					code TEXT PRIMARY KEY, created_at INTEGER, expires_at INTEGER,
					used INTEGER DEFAULT 0, device_name TEXT, device_id TEXT)`,
			),
			env.DB.prepare(
				`CREATE TABLE IF NOT EXISTS sessions (
					token_hash TEXT PRIMARY KEY, device_id TEXT, device_name TEXT,
					created_at INTEGER, expires_at INTEGER, revoked INTEGER DEFAULT 0,
					last_used_at INTEGER)`,
			),
		]);
		await schemaReady;
		schemaReady = true;
	}
}

async function newDeviceId(db) {
	const id = randomToken().slice(0, 16);
	await db.prepare("INSERT INTO sessions (token_hash, device_id, device_name, created_at, expires_at, revoked, last_used_at) VALUES (?, NULL, NULL, ?, ?, 0, ?)")
		// sentinel row only used when nothing else frees the id — effectively never needed,
		// kept because device ids must be unique across link + session rows
		.bind("deviceid:" + id, nowSec(), nowSec(), nowSec()).run();
	return id;
}

// ── Freebuff upstream (honest proxy) ───────────────────────────────
// (chat has its own handler below — this one is for plain JSON GET proxies)
async function upstream(path, token, init = {}) {
	if (!path) return { unavailable: true };
	const headers = { "Content-Type": "application/json" };
	if (FREEBUFF.upstreamAuthValue) headers["Authorization"] = FREEBUFF.upstreamAuthValue;
	if (token) headers["X-Freebuff-Session"] = token;
	try {
		const res = await fetch(path, { method: init.method || "GET", headers, body: init.body });
		const text = await res.text();
		if (res.status === 0 || res.status >= 500) return { network: true, status: res.status };
		let json = null;
		try { json = JSON.parse(text); } catch { /* plain text */ }
		return { status: res.status, json, text, headers: res.headers };
	} catch {
		return { network: true, status: 0 };
	}
}
function unavailableResponse() {
	return fail("unavailable", "Freebuff endpoint not reachable/configured — no data invented.", 503);
}

// Map upstream failures/errors to the contract's error codes.
function mapUpstreamError(u) {
	if (!u || u.unavailable) return { error: "unavailable", message: "Freebuff endpoint not reachable/configured — no data invented.", status: 503 };
	if (u.network) return { error: "network_error", message: "Could not reach the Freebuff endpoint (network error).", status: 502 };
	if (u.status === 401 || u.status === 403) return { error: "not_logged_in", message: "Your session is not valid for this Freebuff endpoint.", status: 401 };
	if (u.status === 429) return { error: "rate_limited", message: "Freebuff is rate limiting right now — retry in a moment.", status: 429 };
	if (u.status === 402) return { error: "quota_used_up", message: "Allowance used up (upstream 402).", status: 402 };
	if (u.status >= 500) return { error: "server_error", message: "Freebuff upstream error (HTTP " + u.status + ").", status: 502 };
	return { error: "server_error", message: "Freebuff upstream error (HTTP " + u.status + ").", status: 502 };
}

// ── device link ──────────────────────────────────────────────────────
async function linkStart(req, env) {
	const ip = clientIp(req);
	const rl = rateHit("link:" + ip, RATE_LIMIT.linkPerMin);
	if (rl.limited) return fail("rate_limited", "Too many link requests — wait " + rl.retryAfter + "s.", 429, { "Retry-After": String(rl.retryAfter) });

	const code = randomCode();
	const created = nowSec();
	const expires = created + LINK_TTL_SEC;
	await env.DB.prepare(
		"INSERT INTO link_codes (code, created_at, expires_at, used, device_name, device_id) VALUES (?, ?, ?, 0, '', '')",
	).bind(code, created, expires).run();
	return jsonResponse({ ok: true, code, expiresAt: expires * 1000, pollAfterMs: POLL_INTERVAL_MS });
}

async function linkPoll(req, env, url) {
	const code = (url.searchParams.get("code") || "").toUpperCase().trim();
	const ip = clientIp(req);
	const rl = rateHit("link:" + ip, RATE_LIMIT.linkPerMin);
	if (rl.limited) return fail("rate_limited", "Too many link requests — wait " + rl.retryAfter + "s.", 429, { "Retry-After": String(rl.retryAfter) });
	if (!/^[A-Z0-9]{8}$/.test(code)) return fail("invalid_code", "Code must be 8 characters.", 400);

	const row = await env.DB.prepare("SELECT * FROM link_codes WHERE code = ?").bind(code).first();
	if (!row) return fail("invalid_code", "Unknown link code.", 404);
	if (row.used) return fail("already_used", "This code was already used.", 410);
	if (row.expires_at < nowSec()) return jsonResponse({ ok: true, status: "expired", expiresInSec: 0 });

	if (row.device_id) {
		// confirm already written the device row → mint the session for the script
		const token = randomToken();
		const created = nowSec();
		const expires = created + SESSION_TTL_SEC;
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO sessions (token_hash, device_id, device_name, created_at, expires_at, revoked, last_used_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
			).bind(await hashToken(token), row.device_id, row.device_name, created, expires, created),
			env.DB.prepare("UPDATE link_codes SET used = 1 WHERE code = ?").bind(code),
		]);
		return jsonResponse({
			ok: true, status: "linked", sessionToken: token,
			account: { name: row.device_name || "Linked device", initial: (row.device_name || "D")[0].toUpperCase(), plan: null },
			expiresInSec: SESSION_TTL_SEC,
		});
	}
	return jsonResponse({ ok: true, status: "pending", expiresInSec: row.expires_at - nowSec() });
}

async function linkConfirm(req, env) {
	const body = await readJson(req);
	if (!csrfOk(req)) return fail("csrf", "Missing or wrong CSRF token.", 403);
	const ip = clientIp(req);
	const rl = rateHit("link:" + ip, RATE_LIMIT.linkPerMin);
	if (rl.limited) return fail("rate_limited", "Too many link requests — wait " + rl.retryAfter + "s.", 429, { "Retry-After": String(rl.retryAfter) });

	const code = String(body.code || "").toUpperCase().trim();
	const deviceName = String(body.deviceName || "").slice(0, 64) || "Roblox script";
	if (!/^[A-Z0-9]{8}$/.test(code)) return fail("invalid_code", "Code must be 8 characters.", 400);

	const row = await env.DB.prepare("SELECT * FROM link_codes WHERE code = ?").bind(code).first();
	if (!row) return fail("invalid_code", "Unknown link code.", 404);
	if (row.used) return fail("already_used", "This code was already used.", 410);
	if (row.expires_at < nowSec()) return fail("code_expired", "This code expired — start a new one on the Roblox script.", 410);

	const deviceId = await newDeviceId(env.DB);
	await env.DB.prepare(
		"UPDATE link_codes SET device_name = ?, device_id = ?, used = 0 WHERE code = ?",
	).bind(deviceName, deviceId, code).run();
	// The session token is NOT handed to the browser — the script picks it up via poll.
	return jsonResponse({ ok: true, status: "linked", device: { id: deviceId, name: deviceName } });
}

// ── sessions ────────────────────────────────────────────────────────
async function getSession(env, token) {
	if (!token) return null;
	const h = await hashToken(token);
	const row = await env.DB.prepare("SELECT * FROM sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > ?")
		.bind(h, nowSec()).first();
	if (row) {
		await env.DB.prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?").bind(nowSec(), h).run();
	}
	return row || null;
}

async function authValidate(req, env) {
	const body = await readJson(req);
	const row = await getSession(env, body.token);
	if (!row) {
		return jsonResponse({ ok: true, valid: false, account: null });
	}
	return jsonResponse({
		ok: true, valid: true,
		account: { name: row.device_name || "Linked device", initial: (row.device_name || "D")[0].toUpperCase(), plan: null },
	});
}

async function authRevoke(req, env) {
	const body = await readJson(req);
	if (!csrfOk(req)) return fail("csrf", "Missing or wrong CSRF token.", 403);
	const row = await getSession(env, body.token);
	if (!row) return fail("invalid_token", "Unknown or already-revoked session.", 404);
	const h = await hashToken(body.token);
	await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ? OR device_id = ? AND token_hash != ?")
		.bind(h, row.device_id || "", h).run();
	return jsonResponse({ ok: true });
}

// ── device registry ─────────────────────────────────────────────────
async function devices(req, env, url) {
	const token = url.searchParams.get("token") || "";
	const row = await getSession(env, token);
	if (!row) return fail("not_logged_in", "Session invalid or expired.", 401);
	if (!row.device_id) return jsonResponse({ ok: true, devices: [] });
	const rs = await env.DB.prepare(
		"SELECT device_id, device_name, created_at, last_used_at FROM sessions WHERE device_id = ? AND revoked = 0",
	).bind(row.device_id).all();
	const devices = rs.results.map(d => ({
		id: d.device_id,
		name: d.device_name || "Linked device",
		lastUsedAt: (d.last_used_at || d.created_at) * 1000,
	}));
	return jsonResponse({ ok: true, devices });
}

async function devicesRevoke(req, env) {
	const body = await readJson(req);
	if (!csrfOk(req)) return fail("csrf", "Missing or wrong CSRF token.", 403);
	const row = await getSession(env, body.token);
	if (!row) return fail("not_logged_in", "Session invalid or expired.", 401);
	if (!body.deviceId) return fail("invalid_request", "deviceId required.", 400);
	await env.DB.prepare("UPDATE sessions SET revoked = 1 WHERE device_id = ?").bind(body.deviceId).run();
	await env.DB.prepare("UPDATE link_codes SET used = 1 WHERE device_id = ?").bind(body.deviceId).run();
	return jsonResponse({ ok: true });
}

// ── proxied Freebuff routes (honest: unavailable when not configured) ──
async function proxied(route, configPath, req, env, url) {
	const token = url.searchParams.get("token") || "";
	const row = await getSession(env, token);
	if (!row) return fail("not_logged_in", "Session invalid or expired.", 401);
	const rl = rateHit("tok:" + row.token_hash, RATE_LIMIT.apiPerMin);
	if (rl.limited) return fail("rate_limited", "Too many requests for your session — wait " + rl.retryAfter + "s.", 429);

	const u = await upstream(configPath, token);
	if (u.unavailable || u.network) {
		const err = mapUpstreamError(u);
		return fail(err.error, err.message, err.status);
	}
	if (!u.json) return fail("server_error", "Freebuff returned a non-JSON body.", 502);
	return jsonResponse({ ok: true, [route]: u.json });
}

// dedicated chat handler (streams SSE opaquely when supported)
async function chat(req, env) {
	const body = await readJson(req);
	const row = await getSession(env, body.token);
	if (!row) return fail("not_logged_in", "Session invalid or expired.", 401);
	const rl = rateHit("tok:" + row.token_hash, RATE_LIMIT.apiPerMin);
	if (rl.limited) return fail("rate_limited", "Too many requests for your session — wait " + rl.retryAfter + "s.", 429);

	if (!FREEBUFF.chat) return unavailableResponse();

	const payload = {
		model: body.model || "default",
		messages: Array.isArray(body.messages) ? body.messages.slice(-24) : [],
		stream: Boolean(body.stream),
	};
	let ures;
	try {
		ures = await fetch(FREEBUFF.chat, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(FREEBUFF.upstreamAuthValue ? { Authorization: FREEBUFF.upstreamAuthValue } : {}),
			},
			body: JSON.stringify(payload),
		});
	} catch {
		return fail("network_error", "Could not reach the Freebuff chat endpoint (network error).", 502);
	}
	if (body.stream && ures.headers.get("content-type").includes("text/event-stream")) {
		return new Response(ures.body, {
			status: ures.status,
			headers: { "content-type": "text/event-stream", "cache-control": "no-store", ...securityHeaders() },
		});
	}
	const text = await ures.text();
	let json = null;
	try { json = JSON.parse(text); } catch { /* leave null */ }
	if (ures.status === 401 || ures.status === 403) return fail("token_expired", "Your session is not valid for this Freebuff endpoint.", 401);
	if (ures.status === 429) return fail("rate_limited", "Freebuff is rate limiting right now — retry in a moment.", 429);
	if (ures.status === 402) return fail("quota_used_up", "Allowance used up (upstream 402).", 402);
	if (ures.status >= 500) return fail("server_error", "Freebuff upstream error (HTTP " + ures.status + ").", 502);
	const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
	if (typeof content === "string" && content.length) return jsonResponse({ ok: true, reply: content });
	if (typeof (json && json.reply) === "string" && json.reply.length) return jsonResponse({ ok: true, reply: json.reply });
	return fail("empty_reply", "Freebuff returned no text for this request.", 502);
}

// ── CSRF (double-submit cookie) for browser-mutating routes ─────────
const CSRF_COOKIE = "fb_csrf";
function csrfOk(req) {
	const cookie = req.headers.get("cookie") || "";
	const m = cookie.match(new RegExp(CSRF_COOKIE + "=([A-Za-z0-9_-]+)"));
	if (!m) return false;
	const header = req.headers.get("x-csrf-token") || "";
	return header.length >= 16 && header === m[1];
}
function ensureCsrfCookie(req) {
	const cookie = req.headers.get("cookie") || "";
	const m = cookie.match(new RegExp(CSRF_COOKIE + "=([A-Za-z0-9_-]+)"));
	return m ? m[1] : "";
}

// ── router ───────────────────────────────────────────────────────────
export default {
	async fetch(request, env) {
		try {
			return await handle(request, env);
		} catch (err) {
			// honest internal error (no stack, no secrets) instead of a 502 page
			return jsonResponse({ ok: false, error: "internal_error", message: "Backend error: " + err.message }, 500, {
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
			});
		}
	},
};

async function handle(request, env) {
	const req = request;
		await ensureSchema(env);
		const url = new URL(req.url);
		const path = url.pathname;
		const cors = corsHeaders(req);

		if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

		const J = (obj, status, extra) => jsonResponse(obj, status, { ...cors, ...(extra || {}) });
		const F = (err, msg, status, extra) => fail(err, msg, status, { ...cors, ...(extra || {}) });

		// health (also publishes the website-login URL only once it is configured)
		if (path === "/api/health") {
			return J({
				ok: true, service: "freebuff-client-backend", time: Date.now(),
				...(FREEBUFF.freebuffLoginUrl ? { freebuffLoginUrl: FREEBUFF.freebuffLoginUrl } : {}),
			});
		}

		// issue/refresh CSRF cookie for browser clients
		if (path === "/api/csrf") {
			let tok = ensureCsrfCookie(req);
			let setCookie = null;
			if (!tok) {
				tok = randomToken().slice(0, 24);
				setCookie = CSRF_COOKIE + "=" + tok + "; SameSite=Lax; Path=/; Max-Age=86400";
			}
			return J({ ok: true, csrf: tok }, 200, setCookie ? { "Set-Cookie": setCookie } : {});
		}	switch (true) {
		case path === "/api/link/start" && req.method === "POST":
			return linkStart(req, env).then(r => withCors(r, cors));
		case path === "/api/link/poll" && req.method === "GET":
			return linkPoll(req, env, url).then(r => withCors(r, cors));
		case path === "/api/link/confirm" && req.method === "POST":
			return linkConfirm(req, env).then(r => withCors(r, cors));
		case path === "/api/auth/validate" && req.method === "POST":
			return authValidate(req, env).then(r => withCors(r, cors));
		case path === "/api/auth/revoke" && req.method === "POST":
			return authRevoke(req, env).then(r => withCors(r, cors));
		case path === "/api/devices" && req.method === "GET":
			return devices(req, env, url).then(r => withCors(r, cors));
		case path === "/api/devices/revoke" && req.method === "POST":
			return devicesRevoke(req, env).then(r => withCors(r, cors));
		case path === "/api/account" && req.method === "GET":
			return proxied("account", FREEBUFF.account, req, env, url).then(r => withCors(r, cors));
		case path === "/api/usage" && req.method === "GET":
			return proxied("usage", FREEBUFF.usage, req, env, url).then(r => withCors(r, cors));
		case path === "/api/models" && req.method === "GET":
			return proxied("models", FREEBUFF.models, req, env, url).then(r => withCors(r, cors));
		case path === "/api/chat" && req.method === "POST":
			return chat(req, env).then(r => withCors(r, cors));
		default:
			// static assets (the website) with a SPA-ish fallback for browser routes
			if (req.method === "GET" && env.ASSETS && !path.startsWith("/api/")) {
				const page = env.ASSETS.fetch(request);
				return withCors(page, cors);
			}
			return F("unknown_route", "No such API route: " + req.method + " " + path + " — check the docs.", 404);
	}
}

function withCors(r, cors) {
	const headers = new Headers(r.headers);
	for (const [k, v] of Object.entries(cors)) headers.set(k, v);
	return new Response(r.body, { status: r.status, headers });
}
