var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var ALLOWED_DOMAIN = "intransittech.com";
var SESSION_TTL_S = 8 * 60 * 60;
var GOOGLE_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
var ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
var SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
var RESEND_API = "https://api.resend.com/emails";
var WORKER_URL = "https://intransit-worker.intransit-sales.workers.dev";
var APPROVAL_TTL_S = 48 * 60 * 60;
var OFFHOURS_GRANT_S = 24 * 60 * 60;
function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Google-Token, X-Session-Token",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(body, request, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", ...extra }
  });
}
__name(jsonResponse, "jsonResponse");
var _saToken = null;
var _saTokenExpiry = 0;
async function getServiceAccountToken(env) {
  const now = Math.floor(Date.now() / 1e3);
  if (_saToken && now < _saTokenExpiry - 60) return _saToken;
  const creds = JSON.parse(env.GOOGLE_CREDENTIALS);
  const b64u = /* @__PURE__ */ __name((s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""), "b64u");
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const sigInput = `${header}.${payload}`;
  const pem = creds.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(sigInput)
  );
  const sig = b64u(String.fromCharCode(...new Uint8Array(sigBytes)));
  const jwt = `${sigInput}.${sig}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("SA token error: " + JSON.stringify(data));
  _saToken = data.access_token;
  _saTokenExpiry = now + 3600;
  return _saToken;
}
__name(getServiceAccountToken, "getServiceAccountToken");
function b64url(str) {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
__name(b64url, "b64url");
function b64urlDecode(str) {
  return atob(str.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    str.length + (4 - str.length % 4) % 4,
    "="
  ));
}
__name(b64urlDecode, "b64urlDecode");
async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage
  );
}
__name(hmacKey, "hmacKey");
async function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret, ["sign"]);
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sig = b64url(String.fromCharCode(...new Uint8Array(sigBuf)));
  return `${data}.${sig}`;
}
__name(signJWT, "signJWT");
async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const data = `${header}.${body}`;
    const key = await hmacKey(secret, ["verify"]);
    const sigBytes = Uint8Array.from(b64urlDecode(sig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(data)
    );
    if (!valid) return null;
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp < Math.floor(Date.now() / 1e3)) return null;
    return payload;
  } catch {
    return null;
  }
}
__name(verifyJWT, "verifyJWT");
function getSessionCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)it_session=([^;]+)/);
  return m ? m[1] : null;
}
__name(getSessionCookie, "getSessionCookie");
async function getSession(request, env) {
  const cookieToken = getSessionCookie(request);
  if (cookieToken) {
    const payload = await verifyJWT(cookieToken, env.SESSION_SECRET);
    if (payload) return payload;
  }
  const headerToken = request.headers.get("X-Session-Token");
  if (headerToken) return verifyJWT(headerToken, env.SESSION_SECRET);
  return null;
}
__name(getSession, "getSession");
function sessionCookieHeader(token, maxAgeS) {
  return `it_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeS}`;
}
__name(sessionCookieHeader, "sessionCookieHeader");
async function handleServeApp(request, env) {
  if (!env.INTRANSIT_HTML) return new Response("KV not bound", { status: 500 });
  const html = await env.INTRANSIT_HTML.get("app");
  if (!html) return new Response("App not deployed to KV yet", { status: 404 });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": "no-store, no-cache, must-revalidate"
    }
  });
}
__name(handleServeApp, "handleServeApp");
async function handleCheckSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return jsonResponse({ error: "No active session" }, request, 401);
  return jsonResponse({ email: session.email, name: session.name, exp: session.exp, isAdmin: session.isAdmin }, request);
}
__name(handleCheckSession, "handleCheckSession");
function handleSignout(request) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Set-Cookie": "it_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0"
    }
  });
}
__name(handleSignout, "handleSignout");
function getLocalTimeDetails(tz) {
  const now = /* @__PURE__ */ new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short"
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  return { hour, minute, weekday };
}
__name(getLocalTimeDetails, "getLocalTimeDetails");
function checkBusinessHours(env) {
  const tz = env.TIMEZONE || "America/Chicago";
  const startHour = parseInt(env.BUSINESS_START_HOUR || "7", 10);
  const endHour = parseInt(env.BUSINESS_END_HOUR || "17", 10);
  const { hour, minute, weekday } = getLocalTimeDetails(tz);
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const inHours = hour >= startHour && hour < endHour;
  const currentMin = hour * 60 + minute;
  const endMin = endHour * 60;
  const minutesLeft = Math.max(0, endMin - currentMin);
  return { isWeekday, inHours, isOpen: isWeekday && inHours, minutesLeft, weekday, hour };
}
__name(checkBusinessHours, "checkBusinessHours");
function isMobileDevice(request) {
  const dt = (request.cf?.deviceType || "").toLowerCase();
  return dt === "mobile" || dt === "tablet";
}
__name(isMobileDevice, "isMobileDevice");
function isAllowedMobile(email, env) {
  const allowed = (env.ALLOWED_MOBILE_EMAILS || "").split(",").map((e) => e.trim().toLowerCase());
  return allowed.includes(email.toLowerCase());
}
__name(isAllowedMobile, "isAllowedMobile");
async function checkIP(ip, env) {
  if (!env.IP_ALLOWLIST) return { status: "approved" };
  const officeSubnet = (env.OFFICE_IP || "").split(".").slice(0, 3).join(".") + ".";
  if (ip === env.OFFICE_IP || ip.startsWith(officeSubnet)) return { status: "approved", auto: true };
  const raw = await env.IP_ALLOWLIST.get(ip);
  if (!raw) return { status: "new" };
  try {
    return JSON.parse(raw);
  } catch {
    return { status: "approved" };
  }
}
__name(checkIP, "checkIP");
async function setIP(ip, data, env) {
  if (!env.IP_ALLOWLIST) return;
  await env.IP_ALLOWLIST.put(ip, JSON.stringify(data));
}
__name(setIP, "setIP");
async function handleListIPs(request, env) {
  if (!env.IP_ALLOWLIST) return jsonResponse([], request);
  const listed = await env.IP_ALLOWLIST.list();
  const results = await Promise.all(
    listed.keys.map(async (k) => {
      const raw = await env.IP_ALLOWLIST.get(k.name);
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {
      }
      return { ip: k.name, ...data };
    })
  );
  return jsonResponse(results, request);
}
__name(handleListIPs, "handleListIPs");
async function handleRevokeIP(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid body" }, request, 400);
  }
  const { ip } = body;
  if (!ip) return jsonResponse({ error: "ip required" }, request, 400);
  await setIP(ip, { status: "revoked", revokedAt: (/* @__PURE__ */ new Date()).toISOString() }, env);
  return jsonResponse({ ok: true }, request);
}
__name(handleRevokeIP, "handleRevokeIP");
async function handleApproveIPDirect(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid body" }, request, 400);
  }
  const { ip } = body;
  if (!ip) return jsonResponse({ error: "ip required" }, request, 400);
  await setIP(ip, { status: "approved", approvedAt: (/* @__PURE__ */ new Date()).toISOString(), approvedBy: "admin-panel" }, env);
  return jsonResponse({ ok: true }, request);
}
__name(handleApproveIPDirect, "handleApproveIPDirect");
async function checkOffHoursGrant(email, env) {
  if (!env.OFFHOURS_ACCESS) return false;
  const raw = await env.OFFHOURS_ACCESS.get(email.toLowerCase());
  if (!raw) return false;
  try {
    const grant = JSON.parse(raw);
    return grant.exp > Math.floor(Date.now() / 1e3);
  } catch {
    return false;
  }
}
__name(checkOffHoursGrant, "checkOffHoursGrant");
async function setOffHoursGrant(email, env) {
  if (!env.OFFHOURS_ACCESS) return;
  const exp = Math.floor(Date.now() / 1e3) + OFFHOURS_GRANT_S;
  await env.OFFHOURS_ACCESS.put(email.toLowerCase(), JSON.stringify({ exp, approvedAt: (/* @__PURE__ */ new Date()).toISOString() }));
}
__name(setOffHoursGrant, "setOffHoursGrant");
async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.warn("[EMAIL] No RESEND_API_KEY set");
    return;
  }
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Intransit App <onboarding@resend.dev>",
      to: [to],
      subject,
      html
    })
  });
  if (!res.ok) console.warn("[EMAIL] Resend error:", res.status, await res.text().catch(() => ""));
}
__name(sendEmail, "sendEmail");
function approvalEmailHtml({ title, lines, approveUrl, denyUrl, approveLabel, denyLabel, note }) {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:520px;margin:32px auto;color:#1e293b">
<div style="background:#0f172a;padding:18px 24px;border-radius:8px 8px 0 0">
  <span style="color:#38bdf8;font-weight:700;font-size:18px">Intransit App</span>
  <span style="color:#94a3b8;font-size:14px;margin-left:12px">${title}</span>
</div>
<div style="border:1px solid #e2e8f0;border-top:0;padding:24px;border-radius:0 0 8px 8px">
  ${lines.map((l) => `<div style="margin-bottom:10px"><span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.05em">${l.label}</span><br><strong>${l.value}</strong></div>`).join("")}
  <div style="margin-top:24px;display:flex;gap:12px">
    <a href="${approveUrl}" style="background:#16a34a;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">${approveLabel || "APPROVE"}</a>
    <a href="${denyUrl}"    style="background:#dc2626;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;font-weight:600">${denyLabel || "DENY"}</a>
  </div>
  ${note ? `<p style="margin-top:16px;font-size:12px;color:#94a3b8">${note}</p>` : ""}
</div></body></html>`;
}
__name(approvalEmailHtml, "approvalEmailHtml");
async function handleAuth(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, request, 400);
  }
  const { idToken } = body;
  if (!idToken) return jsonResponse({ error: "idToken required" }, request, 400);
  const gRes = await fetch(`${GOOGLE_TOKENINFO}?id_token=${encodeURIComponent(idToken)}`);
  if (!gRes.ok) return jsonResponse({ error: "Google token verification failed" }, request, 401);
  const g = await gRes.json();
  if (g.aud !== env.GOOGLE_CLIENT_ID)
    return jsonResponse({ error: "Token audience mismatch" }, request, 401);
  if (g.hd !== ALLOWED_DOMAIN || !g.email?.endsWith(`@${ALLOWED_DOMAIN}`))
    return jsonResponse({ error: "Access restricted to @intransittech.com accounts" }, request, 403);
  const email = g.email.toLowerCase();
  const name = g.name || "";
  const isAdmin = email === (env.ADMIN_EMAIL || "").toLowerCase();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const location = [request.cf?.city, request.cf?.region, request.cf?.country].filter(Boolean).join(", ") || "unknown";
  if (!isAdmin && isMobileDevice(request) && !isAllowedMobile(email, env)) {
    return jsonResponse({
      error: "MOBILE_BLOCKED",
      message: "Mobile and tablet access is not enabled for your account."
    }, request, 403);
  }
  if (!isAdmin) {
    const ipStatus = await checkIP(ip, env);
    if (ipStatus.status === "new") {
      await setIP(ip, { status: "pending", requestedAt: (/* @__PURE__ */ new Date()).toISOString(), email, location }, env);
      const approveToken = await signJWT(
        { type: "ip_approve", ip, email, location, iat: Math.floor(Date.now() / 1e3), exp: Math.floor(Date.now() / 1e3) + APPROVAL_TTL_S },
        env.SESSION_SECRET
      );
      const denyToken = await signJWT(
        { type: "ip_deny", ip, email, iat: Math.floor(Date.now() / 1e3), exp: Math.floor(Date.now() / 1e3) + APPROVAL_TTL_S },
        env.SESSION_SECRET
      );
      await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: `[Intransit App] New IP Requesting Access \u2014 ${ip}`,
        html: approvalEmailHtml({
          title: "IP Access Request",
          lines: [
            { label: "IP Address", value: ip },
            { label: "Location", value: location },
            { label: "Requested by", value: `${name} (${email})` },
            { label: "Time", value: (/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: env.TIMEZONE || "America/Chicago" }) + " " + (env.TIMEZONE || "CT") }
          ],
          approveUrl: `${WORKER_URL}/admin/approve?t=${approveToken}`,
          denyUrl: `${WORKER_URL}/admin/deny?t=${denyToken}`,
          approveLabel: "APPROVE IP",
          denyLabel: "DENY IP",
          note: "This link expires in 48 hours."
        })
      });
      return jsonResponse({ error: "IP_PENDING", message: "Your IP address has not been approved yet. An access request has been sent to the administrator." }, request, 403);
    }
    if (ipStatus.status === "pending") {
      return jsonResponse({ error: "IP_PENDING", message: "Your IP address approval is still pending. Please check back after the administrator has approved your request." }, request, 403);
    }
    if (ipStatus.status === "denied") {
      return jsonResponse({ error: "IP_BLOCKED", message: "Access from your IP address has been denied. Contact the administrator." }, request, 403);
    }
    if (ipStatus.status === "revoked") {
      return jsonResponse({ error: "IP_BLOCKED", message: "Access from your IP address has been revoked. Contact the administrator." }, request, 403);
    }
  }
  if (!isAdmin) {
    const hours = checkBusinessHours(env);
    if (!hours.isOpen) {
      const hasGrant = await checkOffHoursGrant(email, env);
      if (!hasGrant) {
        const reason = !hours.isWeekday ? "weekend" : "after hours";
        return jsonResponse({
          error: "OUTSIDE_HOURS",
          reason,
          message: `App access is restricted to Monday\u2013Friday, ${env.BUSINESS_START_HOUR || 7}am\u2013${env.BUSINESS_END_HOUR || 5}pm. You are attempting to access during ${reason}.`,
          canRequest: true
        }, request, 403);
      }
    }
  }
  const now = Math.floor(Date.now() / 1e3);
  let sessionExp = now + SESSION_TTL_S;
  if (!isAdmin) {
    const hours = checkBusinessHours(env);
    if (hours.minutesLeft > 0) {
      const eobExp = now + hours.minutesLeft * 60;
      const graceExp = now + 30 * 60;
      sessionExp = Math.min(sessionExp, Math.max(eobExp, graceExp));
    }
  }
  const sessionToken = await signJWT(
    { email, name, iat: now, exp: sessionExp, isAdmin },
    env.SESSION_SECRET
  );
  return new Response(JSON.stringify({ email, name, exp: sessionExp, isAdmin, sessionToken }), {
    status: 200,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookieHeader(sessionToken, sessionExp - now)
    }
  });
}
__name(handleAuth, "handleAuth");
async function handleRequestAccess(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, request, 400);
  }
  const { idToken, reason } = body;
  if (!idToken) return jsonResponse({ error: "idToken required" }, request, 400);
  const gRes = await fetch(`${GOOGLE_TOKENINFO}?id_token=${encodeURIComponent(idToken)}`);
  if (!gRes.ok) return jsonResponse({ error: "Identity verification failed" }, request, 401);
  const g = await gRes.json();
  if (g.hd !== ALLOWED_DOMAIN || !g.email?.endsWith(`@${ALLOWED_DOMAIN}`))
    return jsonResponse({ error: "Not an @intransittech.com account" }, request, 403);
  const email = g.email.toLowerCase();
  const name = g.name || email;
  const hours = checkBusinessHours(env);
  const reason_ = (reason || "").slice(0, 300).trim() || "(no reason given)";
  const typeLabel = !hours.isWeekday ? "Weekend" : "After-Hours";
  const approveToken = await signJWT(
    { type: "offhours_approve", email, iat: Math.floor(Date.now() / 1e3), exp: Math.floor(Date.now() / 1e3) + APPROVAL_TTL_S },
    env.SESSION_SECRET
  );
  const denyToken = await signJWT(
    { type: "offhours_deny", email, iat: Math.floor(Date.now() / 1e3), exp: Math.floor(Date.now() / 1e3) + APPROVAL_TTL_S },
    env.SESSION_SECRET
  );
  await sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[Intransit App] ${typeLabel} Access Request \u2014 ${name}`,
    html: approvalEmailHtml({
      title: `${typeLabel} Access Request`,
      lines: [
        { label: "Rep", value: `${name} (${email})` },
        { label: "Time", value: (/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: env.TIMEZONE || "America/Chicago" }) + " " + (env.TIMEZONE?.split("/")[1] || "CT") },
        { label: "Reason", value: reason_ }
      ],
      approveUrl: `${WORKER_URL}/admin/approve?t=${approveToken}`,
      denyUrl: `${WORKER_URL}/admin/deny?t=${denyToken}`,
      approveLabel: "APPROVE (24 hours)",
      denyLabel: "DENY REQUEST",
      note: "Approving grants access for 24 hours. This link expires in 48 hours."
    })
  });
  return jsonResponse({ ok: true, message: "Access request sent to the administrator." }, request);
}
__name(handleRequestAccess, "handleRequestAccess");
async function handleAdminApprove(request, env) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t");
  if (!t) return htmlPage("Missing token", "No approval token provided.", "#dc2626");
  const payload = await verifyJWT(t, env.SESSION_SECRET);
  if (!payload) return htmlPage("Invalid or Expired", "This approval link has expired or is invalid.", "#dc2626");
  if (payload.type === "ip_approve") {
    await setIP(payload.ip, {
      status: "approved",
      approvedAt: (/* @__PURE__ */ new Date()).toISOString(),
      approvedFor: payload.email,
      location: payload.location || ""
    }, env);
    return htmlPage("IP Approved", `\u2713 IP address <strong>${payload.ip}</strong> has been approved for access.<br><br>Requested by: ${payload.email}`, "#16a34a");
  }
  if (payload.type === "offhours_approve") {
    await setOffHoursGrant(payload.email, env);
    return htmlPage("Access Granted", `\u2713 After-hours access granted to <strong>${payload.email}</strong> for 24 hours.`, "#16a34a");
  }
  return htmlPage("Unknown request type", `Token type "${payload.type}" is not recognized.`, "#dc2626");
}
__name(handleAdminApprove, "handleAdminApprove");
async function handleAdminDeny(request, env) {
  const url = new URL(request.url);
  const t = url.searchParams.get("t");
  if (!t) return htmlPage("Missing token", "No denial token provided.", "#dc2626");
  const payload = await verifyJWT(t, env.SESSION_SECRET);
  if (!payload) return htmlPage("Invalid or Expired", "This link has expired or is invalid.", "#dc2626");
  if (payload.type === "ip_deny") {
    await setIP(payload.ip, {
      status: "denied",
      deniedAt: (/* @__PURE__ */ new Date()).toISOString(),
      requestedBy: payload.email
    }, env);
    return htmlPage("IP Denied", `\u2717 IP address <strong>${payload.ip}</strong> has been denied access.`, "#64748b");
  }
  if (payload.type === "offhours_deny") {
    if (env.OFFHOURS_ACCESS) await env.OFFHOURS_ACCESS.delete(payload.email.toLowerCase());
    return htmlPage("Request Denied", `\u2717 After-hours access request from <strong>${payload.email}</strong> has been denied.`, "#64748b");
  }
  return htmlPage("Unknown request type", `Token type "${payload.type}" is not recognized.`, "#dc2626");
}
__name(handleAdminDeny, "handleAdminDeny");
function htmlPage(title, body, color = "#0f172a") {
  return new Response(`<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center">
<div style="font-size:48px;margin-bottom:16px">${color === "#16a34a" ? "\u2713" : color === "#dc2626" ? "\u2717" : "\u2139"}</div>
<h2 style="color:${color}">${title}</h2>
<p style="color:#475569">${body}</p>
<p style="margin-top:32px;font-size:12px;color:#94a3b8">Intransit Sales App \u2014 Administration</p>
</body></html>`, { status: 200, headers: { "Content-Type": "text/html" } });
}
__name(htmlPage, "htmlPage");
async function handleRequestLogList(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM request_log ORDER BY ts DESC LIMIT 2000").all();
  return jsonResponse(rows.results || [], request);
}
__name(handleRequestLogList, "handleRequestLogList");
async function handleRequestLogAppend(request, env, session) {
  const { type, account_name, rep_id, reason, status, admin_note } = await request.json().catch(() => ({}));
  await env.DB.prepare(
    "INSERT INTO request_log (type, account_name, rep_id, reason, status, admin_note) VALUES (?,?,?,?,?,?)"
  ).bind(type || "", account_name || "", rep_id || session?.email || "", reason || "", status || "PENDING", admin_note || "").run();
  return jsonResponse({ ok: true }, request);
}
__name(handleRequestLogAppend, "handleRequestLogAppend");
async function handleSignaturesList(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM signatures").all();
  return jsonResponse(rows.results || [], request);
}
__name(handleSignaturesList, "handleSignaturesList");
async function handleSignatureSave(request, env, session) {
  const { rep_id, signature_text } = await request.json().catch(() => ({}));
  const rep = rep_id || session?.email || "";
  if (!rep) return jsonResponse({ error: "rep_id required" }, request, 400);
  await env.DB.prepare(`
    INSERT INTO signatures (rep_id, signature_text, last_updated)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(rep_id) DO UPDATE SET
      signature_text=excluded.signature_text, last_updated=datetime('now')
  `).bind(rep, signature_text || "").run();
  return jsonResponse({ ok: true }, request);
}
__name(handleSignatureSave, "handleSignatureSave");
async function handleSuggestionsList(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM suggestions ORDER BY created_at DESC LIMIT 500").all();
  return jsonResponse(rows.results || [], request);
}
__name(handleSuggestionsList, "handleSuggestionsList");
async function handleSuggestionAppend(request, env, session) {
  const { date_str, rep_name, rep_email, page, category, description } = await request.json().catch(() => ({}));
  await env.DB.prepare(
    "INSERT INTO suggestions (date_str, rep_name, rep_email, page, category, description) VALUES (?,?,?,?,?,?)"
  ).bind(date_str || "", rep_name || "", rep_email || session?.email || "", page || "", category || "", description || "").run();
  return jsonResponse({ ok: true }, request);
}
__name(handleSuggestionAppend, "handleSuggestionAppend");
async function handleSuggestionUpdate(request, env, id) {
  const { status, admin_response } = await request.json().catch(() => ({}));
  await env.DB.prepare(
    "UPDATE suggestions SET status=COALESCE(?,status), admin_response=COALESCE(?,admin_response) WHERE id=?"
  ).bind(status || null, admin_response || null, parseInt(id)).run();
  return jsonResponse({ ok: true }, request);
}
__name(handleSuggestionUpdate, "handleSuggestionUpdate");
async function handleScheduleGet(request, env, rep) {
  const rows = rep ? await env.DB.prepare("SELECT * FROM schedule WHERE rep=? ORDER BY date, time").bind(rep).all() : await env.DB.prepare("SELECT * FROM schedule ORDER BY rep, date, time").all();
  return jsonResponse(rows.results || [], request);
}
__name(handleScheduleGet, "handleScheduleGet");
async function handleScheduleSave(request, env, session) {
  const { rep, events } = await request.json().catch(() => ({}));
  const repId = rep || session?.email || "";
  if (!repId || !Array.isArray(events)) return jsonResponse({ error: "rep and events[] required" }, request, 400);
  if (!canWriteFor(sessionScope(session, env), repId)) return jsonResponse({ error: "Not allowed for this rep" }, request, 403);
  {
    const stmts = [env.DB.prepare("DELETE FROM schedule WHERE rep=?").bind(repId)].concat(events.map(
      (e) => env.DB.prepare("INSERT INTO schedule (id,type,acc_name,contact_name,contact_email,date,time,note,rep,done) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(e.id || "s" + Date.now(), e.type || "Call", e.accName || "", e.contactName || "", e.contactEmail || "", e.date || "", e.time || "", e.note || "", repId, e.done ? 1 : 0)
    ));
    await env.DB.batch(stmts);
  }
  return jsonResponse({ ok: true }, request);
}
__name(handleScheduleSave, "handleScheduleSave");
async function handleContactNotesList(request, env, session) {
  const rows = await env.DB.prepare("SELECT * FROM contact_notes ORDER BY created_at DESC LIMIT 10000").all();
  const scope = sessionScope(session, env);
  const list = rows.results || [];
  return jsonResponse(scope ? list.filter((r) => repVisible(scope, r.rep)) : list, request);
}
__name(handleContactNotesList, "handleContactNotesList");
async function handleContactNoteSave(request, env, session) {
  const { account_name, contact_name, type, note, date_str, rep } = await request.json().catch(() => ({}));
  if (!account_name || !note) return jsonResponse({ error: "account_name and note required" }, request, 400);
  await env.DB.prepare(
    "INSERT INTO contact_notes (account_name, contact_name, type, note, date_str, rep) VALUES (?,?,?,?,?,?)"
  ).bind(account_name, contact_name || "", type || "General", note, date_str || "", rep || session?.email || "").run();
  return jsonResponse({ ok: true }, request);
}
__name(handleContactNoteSave, "handleContactNoteSave");
async function handleAttackPlanGet(request, env, repId) {
  const rows = repId ? await env.DB.prepare("SELECT * FROM attack_plan WHERE rep_id=? ORDER BY position").bind(repId).all() : await env.DB.prepare("SELECT * FROM attack_plan ORDER BY rep_id, position").all();
  return jsonResponse(rows.results || [], request);
}
__name(handleAttackPlanGet, "handleAttackPlanGet");
async function handleAttackPlanSave(request, env, session) {
  const { rep_id, cards } = await request.json().catch(() => ({}));
  if (!rep_id || !Array.isArray(cards)) return jsonResponse({ error: "rep_id and cards[] required" }, request, 400);
  if (!canWriteFor(sessionScope(session, env), rep_id)) return jsonResponse({ error: "Not allowed for this rep" }, request, 403);
  // one batch = one transaction: a failed insert can no longer leave the plan half-deleted
  const stmts = [env.DB.prepare("DELETE FROM attack_plan WHERE rep_id=?").bind(rep_id)].concat(cards.map(
    (c, i) => env.DB.prepare("INSERT INTO attack_plan (rep_id, account_name, zone, position) VALUES (?,?,?,?)").bind(rep_id, c.name || "", c.zone || "POOL", i)
  ));
  await env.DB.batch(stmts);
  return jsonResponse({ ok: true }, request);
}
__name(handleAttackPlanSave, "handleAttackPlanSave");
async function handleHiddenList(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM hidden_accounts WHERE status='HIDDEN' ORDER BY hidden_at DESC").all();
  return jsonResponse(rows.results || [], request);
}
__name(handleHiddenList, "handleHiddenList");
async function handleHiddenSave(request, env, session) {
  const { account_name, rep_id } = await request.json().catch(() => ({}));
  if (!account_name) return jsonResponse({ error: "account_name required" }, request, 400);
  await env.DB.prepare(`
    INSERT INTO hidden_accounts (account_name, rep_id, hidden_by, hidden_at, status)
    VALUES (?, ?, ?, datetime('now'), 'HIDDEN')
    ON CONFLICT(account_name) DO UPDATE SET
      status='HIDDEN', hidden_by=excluded.hidden_by, hidden_at=datetime('now')
  `).bind(account_name, rep_id || "", session?.email || "").run();
  const tzH = env.TIMEZONE || "America/Los_Angeles";
  const tH = (/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: tzH, dateStyle: "short", timeStyle: "short" });
  sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[Intransit] \u{1F6AB} Account Hidden \u2014 ${account_name}`,
    html: `<div style="font-family:sans-serif;max-width:480px;padding:20px"><h3 style="margin:0 0 12px">Account Hidden</h3>
      <b>${account_name}</b> (rep: ${rep_id || "\u2014"}) was hidden from all views by <b>${session?.email}</b> at ${tH}.
      <div style="margin-top:16px"><a href="${WORKER_URL}/app" style="background:#0f172a;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:12px">Open App</a></div></div>`
  }).catch(() => {
  });
  return jsonResponse({ ok: true }, request);
}
__name(handleHiddenSave, "handleHiddenSave");
async function handleHiddenRestore(request, env, accountName) {
  await env.DB.prepare("UPDATE hidden_accounts SET status='RESTORED' WHERE account_name=?").bind(accountName).run();
  return jsonResponse({ ok: true }, request);
}
__name(handleHiddenRestore, "handleHiddenRestore");
async function handleNotesList(request, env, session) {
  const rows = await env.DB.prepare("SELECT * FROM rep_notes").all();
  const scope = sessionScope(session, env);
  const list = rows.results || [];
  return jsonResponse(scope ? list.filter((r) => repVisible(scope, r.rep_id)) : list, request);
}
__name(handleNotesList, "handleNotesList");
async function handleNoteSave(request, env, session) {
  const { account_name, rep_id, note, follow_up_date, rep_status } = await request.json().catch(() => ({}));
  if (!account_name) return jsonResponse({ error: "account_name required" }, request, 400);
  if (!canWriteFor(sessionScope(session, env), rep_id)) return jsonResponse({ error: "Not allowed for this rep" }, request, 403);
  await env.DB.prepare(`
    INSERT INTO rep_notes (account_name, rep_id, note, follow_up_date, rep_status, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_name) DO UPDATE SET
      rep_id=excluded.rep_id, note=excluded.note,
      follow_up_date=excluded.follow_up_date, rep_status=excluded.rep_status,
      updated_at=datetime('now')
  `).bind(account_name, rep_id || "", note || "", follow_up_date || "", rep_status || "").run();
  return jsonResponse({ ok: true }, request);
}
__name(handleNoteSave, "handleNoteSave");
async function handlePoolGet(request, env) {
  const rows = await env.DB.prepare("SELECT * FROM pool_managed ORDER BY updated_at DESC").all();
  return jsonResponse(rows.results || [], request);
}
__name(handlePoolGet, "handlePoolGet");
async function handlePoolSave(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid body" }, request, 400);
  }
  const { account_name, source_rep, priority, status, assigned_to, approved_by, approved_date, notes } = body;
  if (!account_name) return jsonResponse({ error: "account_name required" }, request, 400);
  await env.DB.prepare(`
    INSERT INTO pool_managed (account_name, source_rep, priority, status, assigned_to, approved_by, approved_date, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_name) DO UPDATE SET
      source_rep   = excluded.source_rep,
      priority     = excluded.priority,
      status       = excluded.status,
      assigned_to  = excluded.assigned_to,
      approved_by  = excluded.approved_by,
      approved_date= excluded.approved_date,
      notes        = excluded.notes,
      updated_at   = datetime('now')
  `).bind(
    account_name,
    source_rep || "",
    priority || "Warm",
    status || "AVAILABLE",
    assigned_to || "ALL",
    approved_by || session.email || "",
    approved_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    notes || ""
  ).run();
  await env.DB.prepare(
    "INSERT INTO pool_actions (action, account_name, rep_id, detail) VALUES (?, ?, ?, ?)"
  ).bind(status, account_name, session.email || "", `${status} by ${session.email}`).run();
  const tz = env.TIMEZONE || "America/Los_Angeles";
  const timeStr = (/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
  const actionLabels = { HIDDEN: "\u{1F6AB} Hidden from pool", AVAILABLE: "\u2705 Added to pool", REMOVED: "\u{1F5D1} Removed", CLAIMED: "\u{1F512} Assigned" };
  const actionLabel = actionLabels[status] || status;
  sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[Intransit Pool] ${actionLabel} \u2014 ${account_name}`,
    html: `<div style="font-family:sans-serif;max-width:480px;padding:20px">
      <h3 style="color:#0f172a;margin:0 0 16px">Pool Management Activity</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:6px 0;color:#64748b;width:110px">Account</td><td style="padding:6px 0;font-weight:600">${account_name}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Action</td><td style="padding:6px 0;font-weight:600">${actionLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">By</td><td style="padding:6px 0">${session.email}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Priority</td><td style="padding:6px 0">${priority || "\u2014"}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Time</td><td style="padding:6px 0">${timeStr}</td></tr>
      </table>
      <div style="margin-top:16px"><a href="${WORKER_URL}/app" style="background:#0f172a;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:12px">Open App</a></div>
    </div>`
  }).catch(() => {
  });
  return jsonResponse({ ok: true }, request);
}
__name(handlePoolSave, "handlePoolSave");
async function handlePoolDelete(request, env, session) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid body" }, request, 400);
  }
  const { account_name } = body;
  if (!account_name) return jsonResponse({ error: "account_name required" }, request, 400);
  await env.DB.prepare("DELETE FROM pool_managed WHERE account_name = ?").bind(account_name).run();
  await env.DB.prepare("INSERT INTO pool_actions (action, account_name, rep_id, detail) VALUES (?,?,?,?)").bind("RESTORED_TO_REVIEW", account_name, session?.email || "", "Restored to Needs Review by " + (session?.email || "admin")).run();
  const tz2 = env.TIMEZONE || "America/Los_Angeles";
  const t2 = (/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: tz2, dateStyle: "short", timeStyle: "short" });
  sendEmail(env, {
    to: env.ADMIN_EMAIL,
    subject: `[Intransit Pool] \u21A9 Restored to Needs Review \u2014 ${account_name}`,
    html: `<div style="font-family:sans-serif;max-width:480px;padding:20px"><h3 style="margin:0 0 12px">Pool Activity</h3>
      <b>${account_name}</b> was restored to Needs Review by <b>${session?.email}</b> at ${t2}.
      <div style="margin-top:16px"><a href="${WORKER_URL}/app" style="background:#0f172a;color:#fff;padding:8px 18px;border-radius:6px;text-decoration:none;font-size:12px">Open App</a></div></div>`
  }).catch(() => {
  });
  return jsonResponse({ ok: true }, request);
}
__name(handlePoolDelete, "handlePoolDelete");
async function handlePoolDiag(request, env) {
  const managed = await env.DB.prepare("SELECT COUNT(*) as cnt FROM pool_managed").first();
  const hidden = await env.DB.prepare("SELECT COUNT(*) as cnt FROM pool_managed WHERE status='HIDDEN'").first();
  const sample = await env.DB.prepare("SELECT * FROM pool_managed ORDER BY updated_at DESC LIMIT 5").all();
  const actions = await env.DB.prepare("SELECT COUNT(*) as cnt FROM pool_actions").first();
  const lastActs = await env.DB.prepare("SELECT * FROM pool_actions ORDER BY id DESC LIMIT 5").all();
  return jsonResponse({
    pool_managed_total: managed?.cnt || 0,
    pool_managed_hidden: hidden?.cnt || 0,
    pool_actions_total: actions?.cnt || 0,
    sample_records: sample.results || [],
    recent_actions: lastActs.results || []
  }, request);
}
__name(handlePoolDiag, "handlePoolDiag");
// ══ Data scoping (Nov 2026) ═══════════════════════════════════════════════
// Non-admin sessions only receive rows owned by themselves (managers: their team).
// Keep in sync with CONFIG.REP_EMAIL_MAP / MANAGER_CONFIG in intransit_app.html.
var REP_BY_EMAIL = {
  "john.fluman@intransittech.com": "FJohn",
  "kmancebo@intransittech.com": "CKaren",
  "bill.pratt@intransittech.com": "BillP",
  "ian.pitman@intransittech.com": "PIan",
  "mauricio.rangel@intransittech.com": "RMauricio",
  "mrangel@intransittech.com": "RMauricio",
  "lmancera@intransittech.com": "LMancera",
  "brandonar@intransittech.com": "bcastor",
  "anolan@intransittech.com": "Anolan",
  "jose.cordova@intransittech.com": "JCordova",
  "carlos.mancilla@intransittech.com": "CMancilla",
  "manuel.perezfreyre@intransittech.com": "MPerezfreye"
};
var MX_TEAM = ["CKaren", "BillP", "PIan", "RMauricio", "LMancera", "bcastor", "JCordova"];
var TEAM_BY_REP = { CKaren: MX_TEAM, CMancilla: MX_TEAM, MPerezfreye: MX_TEAM };
var APP_REPS = new Set(["CKaren", "BillP", "PIan", "RMauricio", "LMancera", "bcastor", "FJohn", "Anolan", "JCordova"]);
// Tabs whose rows carry a SALES_REP column and hold money / pipeline data
var SCOPED_TABS = new Set(["_GP", "_INVOICE_HISTORY", "_ORDERS_HISTORY", "_COLLECTIONS", "_COLLECTIONS_INVOICES", "_OPEN_ORDERS", "_REQS", "_QUOTES", "_CONTACTS", "_CONTACT_REVENUE"]);
function sessionScope(session, env) {
  var email = (session && session.email || "").toLowerCase();
  if (email && email === (env.ADMIN_EMAIL || "").toLowerCase()) return null; // admin: everything
  var rep = REP_BY_EMAIL[email] || "";
  var reps = new Set([rep].concat(TEAM_BY_REP[rep] || []).filter(Boolean));
  var emails = new Set([email]);
  Object.keys(REP_BY_EMAIL).forEach(function(e) { if (reps.has(REP_BY_EMAIL[e])) emails.add(e); });
  return { email: email, rep: rep, reps: reps, emails: emails };
}
__name(sessionScope, "sessionScope");
// A row is hidden only when it belongs to ANOTHER app rep outside the caller's scope.
// Rows owned by non-app users (unowned / departed / "Imported") stay visible (prospecting).
function repVisible(scope, owner) {
  owner = String(owner || "").trim();
  if (!owner) return true;
  if (APP_REPS.has(owner)) return scope.reps.has(owner);
  var asRep = REP_BY_EMAIL[owner.toLowerCase()];
  if (asRep) return scope.reps.has(asRep);
  return true;
}
__name(repVisible, "repVisible");
function canWriteFor(scope, owner) {
  if (!scope) return true;
  owner = String(owner || "").trim();
  if (!owner) return true;
  if (scope.emails.has(owner.toLowerCase())) return true;
  return repVisible(scope, owner);
}
__name(canWriteFor, "canWriteFor");
function tabFromRange(rangeEnc) {
  var r = decodeURIComponent(rangeEnc || "");
  var bang = r.lastIndexOf("!");
  var t = bang >= 0 ? r.slice(0, bang) : r;
  t = t.trim();
  if (t.charAt(0) === "'" && t.charAt(t.length - 1) === "'") t = t.slice(1, -1).replace(/''/g, "'");
  return t;
}
__name(tabFromRange, "tabFromRange");
async function handleSheets(request, url, env, session) {
  const googleToken = await getServiceAccountToken(env);
  const sheetsPath = url.pathname.replace("/sheets/", "");
  const sheetsUrl = `${SHEETS_BASE}/${sheetsPath}${url.search}`;
  const init = {
    method: request.method,
    headers: { "Authorization": `Bearer ${googleToken}`, "Content-Type": "application/json" }
  };
  if (request.method !== "GET") init.body = await request.text();
  const scope = sessionScope(session, env);
  if (scope && request.method === "GET") {
    // Block bulk/grid reads that would bypass row scoping
    if (url.searchParams.get("includeGridData") === "true" || /\/values:batchGet/.test(sheetsPath) || url.searchParams.has("ranges")) {
      return jsonResponse({ error: "Not allowed" }, request, 403);
    }
    const m = sheetsPath.match(/^([^/]+)\/values\/([^?]+)$/);
    if (m) {
      const tab = tabFromRange(m[2]);
      const isRepTab = APP_REPS.has(tab);
      if (isRepTab && !scope.reps.has(tab)) {
        return new Response(JSON.stringify({ range: tab, majorDimension: "ROWS", values: [] }), { status: 200, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
      }
      if (SCOPED_TABS.has(tab)) {
        const res0 = await fetch(sheetsUrl, init);
        const text0 = await res0.text();
        if (!res0.ok) return new Response(text0, { status: res0.status, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
        let data; try { data = JSON.parse(text0); } catch (e) { data = null; }
        if (!data || !Array.isArray(data.values)) return new Response(text0, { status: 200, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
        let vals = data.values, idx = -1, start = 0;
        if (vals.length && vals[0].indexOf("SALES_REP") >= 0) { idx = vals[0].indexOf("SALES_REP"); start = 1; }
        else {
          // range did not include the header row — look it up
          const hUrl = `${SHEETS_BASE}/${m[1]}/values/${encodeURIComponent("'" + tab.replace(/'/g, "''") + "'!1:1")}`;
          const hr = await fetch(hUrl, { headers: init.headers });
          const hj = hr.ok ? await hr.json() : {};
          idx = ((hj.values || [])[0] || []).indexOf("SALES_REP");
        }
        if (idx >= 0) {
          const kept = vals.slice(0, start);
          for (let i = start; i < vals.length; i++) if (repVisible(scope, vals[i][idx])) kept.push(vals[i]);
          data.values = kept;
        }
        return new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders(request), "Content-Type": "application/json" } });
      }
    }
  }
  const res = await fetch(sheetsUrl, init);
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}
__name(handleSheets, "handleSheets");
async function handleAI(request, env) {
  const body = await request.text();
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" }
  });
}
__name(handleAI, "handleAI");
function handleGetIP(request) {
  return jsonResponse({ ip: request.headers.get("CF-Connecting-IP") || "unknown" }, request);
}
__name(handleGetIP, "handleGetIP");
function handleGeoIP(request) {
  return jsonResponse({
    ip: request.headers.get("CF-Connecting-IP") || "unknown",
    country: request.cf?.country || "unknown",
    city: request.cf?.city || "unknown",
    region: request.cf?.region || "unknown",
    timezone: request.cf?.timezone || "unknown"
  }, request);
}
__name(handleGeoIP, "handleGeoIP");
async function handleSendAlert(request, session) {
  const body = await request.json().catch(() => ({}));
  const entry = { ...body, triggeredBy: session?.email || "unauthenticated" };
  console.log("[ALERT]", JSON.stringify(entry));
  return jsonResponse({ ok: true }, request);
}
__name(handleSendAlert, "handleSendAlert");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/" || path === "/app") return handleServeApp(request, env);
    if (path === "/get-ip") return handleGetIP(request);
    if (path === "/geoip") return handleGeoIP(request);
    if (path === "/admin/approve") return handleAdminApprove(request, env);
    if (path === "/admin/deny") return handleAdminDeny(request, env);
    if (path === "/check-session" && request.method === "GET") return handleCheckSession(request, env);
    if (path === "/signout" && request.method === "POST") return handleSignout(request);
    if (path === "/auth" && request.method === "POST") return handleAuth(request, env);
    if (path === "/request-access" && request.method === "POST")
      return handleRequestAccess(request, env);
    if (path === "/send-alert" && request.method === "POST") {
      const session2 = await getSession(request, env);
      return handleSendAlert(request, session2);
    }
    const session = await getSession(request, env);
    if (!session) {
      return jsonResponse({ error: "Unauthorized \u2014 session required" }, request, 401);
    }
    const sessionIsAdmin = session.email?.toLowerCase() === (env.ADMIN_EMAIL || "").toLowerCase();
    if (!sessionIsAdmin) {
      const _reqIP = request.headers.get("CF-Connecting-IP") || "";
      const _ipData = await checkIP(_reqIP, env);
      if (_ipData.status !== "approved") {
        return jsonResponse({ error: "IP_NOT_APPROVED", message: "Your IP address is no longer approved. Please contact your administrator." }, request, 401);
      }
    }
    if (path === "/admin/ips" && request.method === "GET") {
      if (!sessionIsAdmin) return jsonResponse({ error: "Admin only" }, request, 403);
      return handleListIPs(request, env);
    }
    if (path === "/admin/revoke-ip" && request.method === "POST") {
      if (!sessionIsAdmin) return jsonResponse({ error: "Admin only" }, request, 403);
      return handleRevokeIP(request, env);
    }
    if (path === "/admin/approve-ip" && request.method === "POST") {
      if (!sessionIsAdmin) return jsonResponse({ error: "Admin only" }, request, 403);
      return handleApproveIPDirect(request, env);
    }
    if (path === "/request-log" && request.method === "GET") return handleRequestLogList(request, env);
    if (path === "/request-log" && request.method === "POST") return handleRequestLogAppend(request, env, session);
    if (path === "/signatures" && request.method === "GET") return handleSignaturesList(request, env);
    if (path === "/signatures" && request.method === "POST") return handleSignatureSave(request, env, session);
    if (path === "/suggestions" && request.method === "GET") return handleSuggestionsList(request, env);
    if (path === "/suggestions" && request.method === "POST") return handleSuggestionAppend(request, env, session);
    if (path.startsWith("/suggestions/") && request.method === "PATCH") return handleSuggestionUpdate(request, env, path.slice(13));
    if (path === "/schedule" && request.method === "POST") return handleScheduleSave(request, env, session);
    if (path.startsWith("/schedule/") && request.method === "GET") return handleScheduleGet(request, env, decodeURIComponent(path.slice(10)));
    if (path === "/schedule" && request.method === "GET") return handleScheduleGet(request, env, null);
    if (path === "/contact-notes" && request.method === "GET") return handleContactNotesList(request, env, session);
    if (path === "/contact-notes" && request.method === "POST") return handleContactNoteSave(request, env, session);
    if (path === "/attack-plan" && request.method === "POST") return handleAttackPlanSave(request, env, session);
    if (path.startsWith("/attack-plan/") && request.method === "GET") { const _ap = decodeURIComponent(path.slice(13)); if (!canWriteFor(sessionScope(session, env), _ap)) return jsonResponse([], request); return handleAttackPlanGet(request, env, _ap); }
    if (path === "/attack-plan" && request.method === "GET") return handleAttackPlanGet(request, env, null);
    if (path === "/hidden" && request.method === "GET") return handleHiddenList(request, env);
    if (path === "/hidden" && request.method === "POST") return handleHiddenSave(request, env, session);
    if (path.startsWith("/hidden/") && request.method === "DELETE") return handleHiddenRestore(request, env, decodeURIComponent(path.slice(8)));
    if (path === "/notes" && request.method === "GET") return handleNotesList(request, env, session);
    if (path === "/notes" && request.method === "POST") return handleNoteSave(request, env, session);
    if (path === "/pool/managed" && request.method === "GET") return handlePoolGet(request, env);
    if (path === "/pool/managed" && request.method === "POST") return handlePoolSave(request, env, session);
    if (path === "/pool/managed" && request.method === "DELETE") return handlePoolDelete(request, env, session);
    if (path === "/pool/diag" && request.method === "GET") {
      if (!sessionIsAdmin) return jsonResponse({ error: "Admin only" }, request, 403);
      return handlePoolDiag(request, env);
    }
    if (path.startsWith("/sheets/")) return handleSheets(request, url, env, session);
    if (path === "/ai") return handleAI(request, env);
    return new Response("Not Found", { status: 404, headers: corsHeaders(request) });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map