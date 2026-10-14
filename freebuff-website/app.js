// ═════════════════════════════════════════════════════════════════════
//  Freebuff client website — logic (vanilla JS, no frameworks)
//  Talks only to the backend routes defined in tmp/TASK_CONTRACT.md.
//  No fake data: every unavailable fetch renders an honest state.
// ═════════════════════════════════════════════════════════════════════
"use strict";

const $ = (sel) => document.querySelector(sel);
const pages = ["home", "link", "login", "account", "help"];

// ── hash router ─────────────────────────────────────────────────────
function route() {
	const hash = (location.hash || "#/").replace(/^#\/?/, "") || "home";
	const page = pages.includes(hash) ? hash : "home";
	for (const p of pages) {
		const el = document.getElementById("page-" + p);
		if (el) el.hidden = p !== page;
	}
	document.querySelectorAll("nav a[data-nav]").forEach((a) => {
		a.classList.toggle("active", a.dataset.nav === page);
	});
	document.getElementById("app").focus({ preventScroll: true });
	window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);
route();

// ── fetch helpers (CSRF double-submit + rate-limit messages) ────────
let csrfToken = null;
async function ensureCsrf() {
	if (csrfToken) return csrfToken;
	const res = await fetch("/api/csrf", { credentials: "same-origin" });
	if (res.ok) {
		const j = await res.json();
		csrfToken = j.csrf;
		document.cookie = "fb_csrf=" + csrfToken + "; SameSite=Lax; Path=/; Max-Age=86400";
	}
	return csrfToken;
}
async function api(path, opts = {}) {
	const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
	if (opts.method && opts.method !== "GET") {
		const token = await ensureCsrf();
		if (token) headers["X-CSRF-Token"] = token;
	}
	let res;
	try {
		res = await fetch(path, Object.assign({}, opts, { headers, credentials: "same-origin" }));
	} catch (e) {
		return { ok: false, error: "network_error", message: "Cannot reach the server — check your connection." };
	}
	let j = null;
	try { j = await res.json(); } catch { /* non-JSON */ }
	if (!res.ok) {
		return j && j.error
			? j
			: { ok: false, error: "server_error", message: "Server error (HTTP " + res.status + ")." };
	}
	return j;
}

function setStatus(el, msg, kind) {
	if (!el) return;
	el.textContent = msg || "";
	el.classList.remove("error", "ok");
	if (kind) el.classList.add(kind);
}

// ── link code form ──────────────────────────────────────────────────
const codeInput = $("#code");
const form = $("#link-form");
if (codeInput && form) {
	// auto-uppercase + strip anything that is not A-Z0-9
	codeInput.addEventListener("input", () => {
		const clean = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
		if (clean !== codeInput.value) codeInput.value = clean;
		codeInput.classList.toggle("ok", clean.length === 8);
		codeInput.classList.toggle("err", codeInput.value.length > 0 && clean.length < 8);
	});
	// paste support: paste full code anywhere on the page
	document.addEventListener("paste", (e) => {
		const text = (e.clipboardData || window.clipboardData).getData("text") || "";
		const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
		if (/^[A-Z0-9]{8}$/.test(clean) && document.activeElement !== codeInput) {
			codeInput.value = clean;
			codeInput.classList.add("ok");
			e.preventDefault();
		}
	});
	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const status = $("#link-status");
		const code = codeInput.value.trim();
		if (!/^[A-Z0-9]{8}$/.test(code)) {
			setStatus(status, "The code must be exactly 8 characters (letters/numbers).", "error");
			codeInput.focus();
			return;
		}
		const btn = $("#link-submit");
		btn.disabled = true;
		setStatus(status, "Checking code…", null);
		const j = await api("/api/link/confirm", {
			method: "POST",
			body: JSON.stringify({ code, deviceName: $("#device-name").value.trim() }),
		});
		btn.disabled = false;
		if (j.ok && j.status === "linked") {
			form.hidden = true;
			$("#link-success").hidden = false;
			setStatus(status, "", null);
		} else {
			const msg = {
				invalid_code: "Unknown code — check it again on the script screen.",
				code_expired: "That code expired. Tap “Link device” in Roblox for a new one.",
				already_used: "That code was already confirmed once. Get a fresh one in Roblox.",
				rate_limited: j.message || "Too many tries — wait a minute.",
				csrf: j.message || "Security check failed — reload the page and try again.",
			}[j.error] || j.message || ("Failed (HTTP " + j.status + ").");
			setStatus(status, msg, "error");
		}
	});
}

// ── login page (honest toggle for unconfirmed Freebuff OAuth) ───────
(async function initLogin() {
	const btn = $("#freebuff-login-btn");
	if (!btn) return;
	// The backend publishes the confirmed login URL only when configured.
	const j = await api("/api/health");
	btn.title = j && j.ok
		? "Requires FREEBUFF.freebuffLoginUrl to be confirmed in the backend config."
		: "Backend unreachable.";
	// It stays disabled until the exposed config endpoint says otherwise:
	// backend /api/health returns `freebuffLoginUrl` only when configured.
	if (j && j.ok && j.freebuffLoginUrl) {
		btn.disabled = false;
		btn.addEventListener("click", () => {
			window.location.href = j.freebuffLoginUrl;
		});
	}
})();

// ── account dashboard ───────────────────────────────────────────────
const TOKEN_KEY = "fb_session_token";
try { sessionStorage.setItem("__probe", "1"); } catch (e) { /* storage may fail */ }
const sessionToken = {
	get() {
		let t = null;
		try { t = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
		return t || $("#session-token").value.trim();
	},
	set(t) {
		try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) {}
	},
	forget() {
		try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
		$("#session-token").value = "";
	},
};

function honestCell(kind, message) {
	return '<p class="hint">⚠ ' + message + " · shown as <strong>Unavailable</strong></p>";
}

async function loadAccount() {
	const status = $("#account-status");
	const body = $("#account-body");
	const token = sessionToken.get();
	if (!token) {
		setStatus(status, "Paste your session token (from LunaAI/session.json) to load the dashboard.", "error");
		return;
	}
	setStatus(status, "Loading real data…", null);
	body.hidden = true;

	const [acc, usage, dev] = await Promise.all([
		api("/api/account?token=" + encodeURIComponent(token)),
		api("/api/usage?token=" + encodeURIComponent(token)),
		api("/api/devices?token=" + encodeURIComponent(token)),
	]);

	if (acc.ok === false && acc.error === "not_logged_in") {
		setStatus(status, "Session invalid or expired — relink the script to get a new token.", "error");
		return;
	}

	const accEl = acc && acc.ok ? acc.account : null;
	$("#acc-avatar").textContent = accEl && accEl.name ? accEl.name[0].toUpperCase() : "?";
	$("#acc-name").innerHTML = accEl ? escapeHtml(accEl.name || "—") : honestCell("account", "Account endpoint unavailable");
	$("#acc-plan").innerHTML = accEl && (accEl.plan !== null && accEl.plan !== undefined)
		? escapeHtml(String(accEl.plan))
		: honestCell("plan", "Plan endpoint unavailable");

	const u = usage && usage.ok ? usage.usage : null;
	if (u && (u.percentUsed !== undefined || u.used !== undefined)) {
		const pct = typeof u.percentUsed === "number"
			? Math.max(0, Math.min(100, u.percentUsed))
			: (u.total && u.used ? Math.round((u.used / u.total) * 100) : 0);
		$("#usage-fill").style.width = pct + "%";
		$("#usage-fill").parentElement.setAttribute("aria-valuenow", String(pct));
		$("#usage-value").textContent = u.label || (u.used + " of " + (u.total ?? "?"));
		$("#usage-reset").textContent = u.resetAt ? new Date(u.resetAt).toLocaleString() : "—";
	} else {
		$("#usage-value").innerHTML = honestCell("usage", "Usage endpoint unavailable");
		$("#usage-reset").textContent = "—";
		$("#usage-fill").style.width = "0%";
	}

	const list = $("#devices-list");
	list.innerHTML = "";
	if (dev && dev.ok && Array.isArray(dev.devices)) {
		if (dev.devices.length === 0) list.innerHTML = '<li class="hint">No linked devices.</li>';
		for (const d of dev.devices) {
			const li = document.createElement("li");
			const info = document.createElement("span");
			info.textContent = d.name + " · last use " + (d.lastUsedAt ? new Date(d.lastUsedAt).toLocaleString() : "unknown");
			const rev = document.createElement("button");
			rev.className = "rev";
			rev.textContent = "Revoke";
			rev.setAttribute("aria-label", "Revoke device " + d.name);
			rev.addEventListener("click", async () => {
				rev.disabled = true;
				const r = await api("/api/devices/revoke", {
					method: "POST",
					body: JSON.stringify({ token: sessionToken.get(), deviceId: d.id }),
				});
				if (r.ok) { loadAccount(); } else { setStatus(status, r.message || "Revoke failed.", "error"); rev.disabled = false; }
			});
			li.appendChild(info);
			li.appendChild(rev);
			list.appendChild(li);
		}
	} else {
		list.innerHTML = '<li class="hint">⚠ Device list unavailable (' + escapeHtml((dev && dev.message) || "error") + ")</li>";
	}

	body.hidden = false;
	setStatus(status, "Loaded.", "ok");
}

function escapeHtml(s) {
	return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
		"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
	}[c]));
}

const loadBtn = $("#load-account");
if (loadBtn) {
	loadBtn.addEventListener("click", loadAccount);
	$("#forget-token").addEventListener("click", () => {
		sessionToken.forget();
		$("#account-body").hidden = true;
		setStatus($("#account-status"), "Token forgotten from this browser.", "ok");
	});
}
