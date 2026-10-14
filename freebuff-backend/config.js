// ═════════════════════════════════════════════════════════════════════
//  Freebuff client — backend config
//  ⚠ IMPORTANT: every `freebuff.*` endpoint below is UNCONFIRMED.
//  Freebuff does not publish a public API doc we could verify.
//  Leave a URL as "" until you have confirmed the real route yourself.
//  When a route is "", the matching route answers:
//    { ok:false, error:"unavailable", message:"Freebuff endpoint not
//      reachable/configured — no data invented." }
//  Never invent numbers, names or balances anywhere in this backend.
// ═════════════════════════════════════════════════════════════════════

export const FREEBUFF = {
	// ⚠ UNCONFIRMED — verify against freebuff.com before filling these in.
	// Expected: OpenAI-compatible JSON endpoints that accept
	// `Authorization: <upstreamAuthValue>` — see upAuth below.
	account: "",   // e.g. "https://freebuff.com/api/v1/account"
	usage:   "",   // e.g. "https://freebuff.com/api/v1/usage"
	models:  "",   // e.g. "https://freebuff.com/api/v1/models"
	chat:    "",   // e.g. "https://freebuff.com/api/v1/chat/completions"

	// Server-side credential used ONLY for outbound upstream calls.
	// Kept as a Worker secret (wrangler secret put FREEBUFF_API_KEY)
	// or set here as a last resort. NEVER returned to clients, never logged.
	upstreamAuthValue: "",  // e.g. "Bearer sk-..."

	// Optional Freebuff website-login page for the "Continue with Freebuff"
	// button on the website. If "", the button renders disabled/Unavailable.
	freebuffLoginUrl: "",
};

// Session tokens: random, SHA-256-hashed in D1, revocable, expire here.
export const SESSION_TTL_SEC = 30 * 24 * 3600;

// Link codes: 8 chars, single use, expire here.
export const LINK_TTL_SEC = 5 * 60;

// CORS lock: ONLY this origin may call the API from a browser.
// Set it to your deployed website origin, e.g. "https://link.example.dev".
// For local development the worker additionally allows localhost origins.
export const WEBSITE_ORIGIN = "";

// Rate limiting (per isolate — good enough for small deployments; put KV/DO
// behind it if you need strict cross-isolate limits).
export const RATE_LIMIT = {
	linkPerMin: 10,      // per IP: link start / poll / confirm
	apiPerMin: 60,       // per token: account / usage / models / chat / devices
};

// How often link/poll may be repeated by the script (ms, advisory).
export const POLL_INTERVAL_MS = 1500;
