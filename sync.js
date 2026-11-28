/* SudarshanAshtra – Live Sync (Super Admin portal on 2+ APPROVED devices at the same time).
   Load this file on the page BEFORE the main app scripts:  <script src="sync.js"></script>
   • Works ONLY when the SudarshanAshtra Super Admin key is active in this browser (Role.admin()).
     .exe users / User edition never see it and nothing is sent or received for them.
   • Each new device must be approved from an already-approved Super Admin device.
   • Data is encrypted on the device (AES-256, sync passphrase) and kept in YOUR OWN Google Apps Script.   v2 */
(function () {
  "use strict";
  if (window.SudSync) return;
  var LSC = "sud-sync-cfg", LSS = "sud-sync-state", LSD = "sud-sync-dirty";
  var EXCL = /^(caseId|ofDir|ofBak|sdrdb|nodal-shared)$/;          // device-only keys – never synced
  var POLL_VIS = 15000, POLL_HID = 120000, DEBOUNCE = 2500;
  var ld = function (k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  var sv = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var hexr = function (n) { return Array.from(crypto.getRandomValues(new Uint8Array(n)), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); };
  var cfg = ld(LSC), st = ld(LSS) || {};
  if (!st.dev || !st.sec) { st.dev = "d" + hexr(10); st.sec = hexr(32); st.seq = 0; sv(LSS, st); }
  st.seq = st.seq || 0;
  var K = null, dirty = new Set(ld(LSD) || []), ft = 0, pt = 0, flushing = false, pulling = false, lastOk = 0, lastErr = "", pend = 0, started = false, booting = false;

  /* ---------- who may use sync: only the Super Admin ---------- */
  function isAdmin() {
    try { if (typeof SUD_ED !== "undefined" && SUD_ED === "user") return false; } catch (e) { return false; }
    try { return typeof Role !== "undefined" && !!Role.admin(); } catch (e) { return false; }
  }

  /* ---------- this browser's SudarshanAshtra database (same layout the app uses) ---------- */
  var _db = null;
  function idb() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (res, rej) {
      var r = indexedDB.open("sudarshanastra", 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
      r.onsuccess = function () { _db = r.result; _db.onversionchange = function () { _db.close(); _db = null; }; res(_db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction("kv", mode), out, r = fn(t.objectStore("kv"));
        if (r) r.onsuccess = function () { out = r.result; };
        t.oncomplete = function () { res(out); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); };
      });
    });
  }
  var iget = function (k) { return tx("readonly", function (s) { return s.get(k); }); };
  var iput = function (k, v) { return tx("readwrite", function (s) { s.put(v, k); }); };
  var idel = function (k) { return tx("readwrite", function (s) { s.delete(k); }); };
  var ikeys = function () { return tx("readonly", function (s) { return s.getAllKeys(); }); };
  var iclear = function () { return tx("readwrite", function (s) { s.clear(); }); };

  /* ---------- turn stored values (incl. files/images) into text and back ---------- */
  function b64(u8) { var s = ""; for (var i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  async function pack(v) {
    if (v == null || typeof v !== "object") return v;
    if (v instanceof Blob) return { __t: "blob", type: v.type, name: v.name || null, last: v.lastModified || null, d: b64(new Uint8Array(await v.arrayBuffer())) };
    if (v instanceof ArrayBuffer) return { __t: "ab", d: b64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { __t: "ta", k: v.constructor.name, d: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Date) return { __t: "date", d: v.toISOString() };
    if (typeof FileSystemHandle !== "undefined" && v instanceof FileSystemHandle) return null;
    if (v instanceof Map) return { __t: "map", d: await pack(Array.from(v)) };
    if (v instanceof Set) return { __t: "set", d: await pack(Array.from(v)) };
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(await pack(v[i])); return a; }
    var o = {}; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = await pack(v[k]); return o;
  }
  function unpack(v) {
    if (v == null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(unpack);
    switch (v.__t) {
      case "blob": { var a = unb64(v.d); return v.name ? new File([a], v.name, { type: v.type, lastModified: v.last || Date.now() }) : new Blob([a], { type: v.type }); }
      case "ab": return unb64(v.d).buffer;
      case "ta": { var b = unb64(v.d), C = window[v.k] || Uint8Array; return new C(b.buffer, 0, b.byteLength / (C.BYTES_PER_ELEMENT || 1)); }
      case "date": return new Date(v.d);
      case "map": return new Map(unpack(v.d));
      case "set": return new Set(unpack(v.d));
    }
    var o = {}; for (var k in v) o[k] = unpack(v[k]); return o;
  }

  /* ---------- encryption: passphrase never leaves the device ---------- */
  var te = new TextEncoder(), td = new TextDecoder();
  async function derive(pass) {
    var base = await crypto.subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey", "deriveBits"]);
    var key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: te.encode("SudarshanAshtra-sync-v1|enc"), iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    var bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: te.encode("SudarshanAshtra-sync-v1|auth"), iterations: 250000, hash: "SHA-256" }, base, 256));
    return { key: key, tok: Array.from(bits, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("") };
  }
  async function gz(u8, un) {
    var S = un ? window.DecompressionStream : window.CompressionStream; if (!S) return null;
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new S("gzip"))).arrayBuffer());
  }
  async function enc(v) {
    var b = te.encode(JSON.stringify(await pack(v))), f = "p", c = await gz(b);
    if (c) { b = c; f = "z"; }
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return f + "1." + b64(iv) + "." + b64(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, K.key, b)));
  }
  async function dec(s) {
    var p = s.split("."), b = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p[1]) }, K.key, unb64(p[2])));
    if (p[0][0] === "z") b = await gz(b, true);
    return unpack(JSON.parse(td.decode(b)));
  }

  /* ---------- talk to the Apps Script ---------- */
  async function api(a, body) {
    var r, j;
    try {
      r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, redirect: "follow", cache: "no-store",
        body: JSON.stringify(Object.assign({ a: a, tok: K.tok, dev: st.dev, ds: st.sec, dn: cfg.name || "" }, body || {})) });
    } catch (e) { throw new Error("No internet / sync server not reachable"); }
    try { j = await r.json(); } catch (e) { throw new Error("Sync server gave a wrong answer – check the Apps Script URL and that it is deployed for 'Anyone'"); }
    if (!j.ok) { var er = new Error(j.err || "Sync error"); er.code = j.code; throw er; }
    return j;
  }
  var on = function () { return !!(cfg && cfg.on && K && isAdmin()); };
  var active = function () { return on() && !cfg.pending; };

  /* ---------- catch every save the app makes ---------- */
  function hook() {
    var D; try { D = DB; } catch (e) { D = null; }      // the app's own DB object
    if (!D || typeof D.set !== "function") return void setTimeout(hook, 250);
    if (D.__sync) return;
    var os = D.set, od = D.del;
    D.set = function (k) { var p = os.apply(this, arguments); Promise.resolve(p).then(function () { mark(k); }, function () {}); return p; };
    if (typeof od === "function") D.del = function (k) { var p = od.apply(this, arguments); Promise.resolve(p).then(function () { mark(k); }, function () {}); return p; };
    D.__sync = 1;
  }
  function mark(k) {
    if (!active() || typeof k !== "string" || EXCL.test(k)) return;
    dirty.add(k); sv(LSD, Array.from(dirty));
    clearTimeout(ft); ft = setTimeout(flush, DEBOUNCE); badge();
  }
  async function flush() {
    if (!active() || flushing || !dirty.size) return;
    flushing = true;
    var keys = Array.from(dirty); dirty.clear();
    try {
      var batch = [], size = 0;
      var send = async function () { if (batch.length) await api("push", { items: batch }); batch = []; size = 0; };
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i], v;
        try { v = await iget(k); } catch (e) { continue; }
        var it = v === undefined ? { k: k, del: 1 } : { k: k, v: await enc(v) };
        batch.push(it); size += (it.v || "").length;
        if (size > 8e6) await send();
      }
      await send();
      sv(LSD, Array.from(dirty)); ok();
    } catch (e) { keys.forEach(function (k) { dirty.add(k); }); sv(LSD, Array.from(dirty)); await fail(e); }
    finally { flushing = false; badge(); }
  }
  async function mergeCases(remote) {
    remote = Array.isArray(remote) ? remote : [];
    var local = await iget("cases"); if (!Array.isArray(local)) return remote;
    var have = new Set(remote.map(function (c) { return c && c.id; })), extra = [];
    for (var i = 0; i < local.length; i++) {
      var c = local[i]; if (!c || have.has(c.id)) continue;
      if ((await iget("case:" + c.id)) !== undefined) extra.push(c);   // still exists here → keep it
    }
    if (extra.length) { dirty.add("cases"); sv(LSD, Array.from(dirty)); return remote.concat(extra); }
    return remote;
  }
  async function pull(quiet) {
    if (!active() || pulling) return [];
    pulling = true; var applied = [];
    try {
      var r = await api("pull", { since: st.seq }), want = [];
      pend = r.pend || 0;
      for (var i = 0; i < r.ch.length; i++) {
        var c = r.ch[i];
        if (c.d === st.dev || EXCL.test(c.k)) continue;
        if (dirty.has(c.k) && c.k !== "cases") continue;          // our newer edit will be sent
        if (c.x) { await idel(c.k); applied.push(c); } else want.push(c);
      }
      var ks = want.map(function (c) { return c.k; });
      while (ks.length) {
        var g = await api("get", { keys: ks }), got = Object.keys(g.vals);
        for (var j = 0; j < got.length; j++) {
          var k = got[j]; if (g.vals[k] == null) continue;
          var v = await dec(g.vals[k]);
          if (k === "cases") v = await mergeCases(v);
          await iput(k, v);
          applied.push(want.find(function (c) { return c.k === k; }));
        }
        if (!got.length && g.more && g.more.length) throw new Error("An item is too large to download");
        ks = g.more || [];
      }
      st.seq = r.seq; sv(LSS, st); ok();
      if (applied.length && !quiet) changed(applied);
    } catch (e) { await fail(e); }
    finally { pulling = false; badge(); }
    return applied;
  }
  async function tick() {
    if (!on()) return;
    if (cfg.pending) {
      try { var h = await api("hello"); if (h.st === "ok") await finishJoin(); else if (!h.st) await fail({ code: "gone", message: "Request was refused / removed" }); }
      catch (e) { await fail(e); }
      return;
    }
    await pull(); await flush();          // fetch first, so a merged case list goes out in the same round
  }
  function loop() {
    clearTimeout(pt); if (!on()) return;
    pt = setTimeout(async function () { await tick(); loop(); }, document.hidden ? POLL_HID : POLL_VIS);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && on()) { tick(); loop(); } });
  window.addEventListener("online", function () { if (on()) tick(); });

  /* ---------- removal / erase ordered by the Super Admin ---------- */
  async function wipeLocal() {
    try { await iclear(); } catch (e) {}
    try { Object.keys(localStorage).forEach(function (k) { if (/^(sud-|sa\.)/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    alert("This device was removed from SudarshanAshtra by the Super Admin.\nAll SudarshanAshtra data on this device has been erased.");
    location.reload();
  }
  async function fail(e) {
    var code = e && e.code;
    if (code === "wipe") return wipeLocal();
    if (code === "gone") { cfg.on = false; cfg.pending = false; sv(LSC, cfg); clearTimeout(pt); lastErr = ""; banner("⛔ This device is no longer allowed to sync (removed or not approved by the Super Admin).", true); return; }
    if (code === "wait") { cfg.pending = true; sv(LSC, cfg); lastErr = ""; return; }
    lastErr = (e && e.message) || String(e); console.warn("SudSync:", lastErr);
  }
  function ok() { lastOk = Date.now(); lastErr = ""; }

  /* ---------- tell the user ---------- */
  function atLogin() { var e = document.getElementById("lgErr"); return !!(e && e.offsetParent !== null); }
  function changed(list) {
    if (atLogin()) return void location.reload();
    var who = Array.from(new Set(list.map(function (c) { return (c && c.n) || "other device"; }))).join(", ");
    var open = null; try { open = (typeof S !== "undefined" && S && S.caseId) ? "case:" + S.caseId : null; } catch (e) {}
    var hit = open && list.some(function (c) { return c && c.k === open; });
    banner(hit ? "⚠ The case open here was just changed on " + who + ". Reload now before you edit it, or one side's work will overwrite the other."
               : "🔄 " + list.length + " update(s) from " + who + ". Reload to see them.", hit, true);
  }
  function el(h) { var d = document.createElement("div"); d.innerHTML = h; return d.firstElementChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var CSS = "#sudSyncB{position:fixed;left:12px;bottom:12px;z-index:2147483000;background:#0b1e3f;color:#fff;border:1px solid #2b4a8f;border-radius:20px;padding:6px 12px;font:600 12.5px Segoe UI,Arial;cursor:pointer;box-shadow:0 2px 10px #0006;display:flex;gap:6px;align-items:center}" +
    "#sudSyncB i{width:9px;height:9px;border-radius:50%;background:#94a3b8;display:inline-block}#sudSyncB i.ok{background:#22c55e}#sudSyncB i.busy{background:#f59e0b}#sudSyncB i.err{background:#ef4444}#sudSyncB i.wait{background:#38bdf8}" +
    "#sudSyncP{position:fixed;left:12px;bottom:52px;z-index:2147483001;width:380px;max-width:calc(100vw - 24px);max-height:calc(100vh - 80px);overflow:auto;background:#0b1e3f;color:#e8eefc;border:1px solid #2b4a8f;border-radius:12px;padding:14px;font:13.5px Segoe UI,Arial;box-shadow:0 6px 24px #0008}" +
    "#sudSyncP h4{margin:0 0 8px;color:#ffc531;font-size:15px}#sudSyncP h5{margin:14px 0 6px;color:#67e8f9;font-size:13.5px}#sudSyncP label{display:block;margin:8px 0 3px;font-size:12px;color:#a5b8e0}#sudSyncP input{width:100%;box-sizing:border-box;padding:7px;border-radius:6px;border:1px solid #2b4a8f;background:#06102e;color:#fff}" +
    "#sudSyncP button{margin:10px 6px 0 0;padding:7px 12px;border:0;border-radius:6px;font-weight:700;cursor:pointer;background:#f59e0b;color:#111}#sudSyncP button.g{background:#1e3a8a;color:#fff}#sudSyncP button.r{background:#b91c1c;color:#fff}#sudSyncP button.s{margin:4px 4px 0 0;padding:4px 8px;font-size:12px}" +
    "#sudSyncP .m{font-size:12px;color:#a5b8e0;margin-top:8px;line-height:1.45}#sudSyncP .e{color:#fca5a5}#sudSyncP .dv{border:1px solid #23407f;border-radius:8px;padding:7px 9px;margin-top:6px;font-size:12.5px}#sudSyncP .dv.w{border-color:#38bdf8;background:#0c2a4a}" +
    "#sudSyncN{position:fixed;left:50%;transform:translateX(-50%);top:10px;z-index:2147483002;background:#0b1e3f;color:#fff;border:1px solid #38e1ff;border-radius:10px;padding:10px 14px;font:600 13.5px Segoe UI,Arial;box-shadow:0 6px 24px #0008;max-width:90vw}#sudSyncN.w{border-color:#ef4444;background:#3b0d0d}" +
    "#sudSyncN button{margin-left:10px;padding:5px 10px;border:0;border-radius:6px;font-weight:700;cursor:pointer;background:#f59e0b}#sudSyncN .x{background:transparent;color:#fff}";
  function ui() {
    if (!document.body) return void document.addEventListener("DOMContentLoaded", ui);
    if (document.getElementById("sudSyncB")) return;
    if (!document.getElementById("sudSyncCss")) document.head.appendChild(el('<style id="sudSyncCss">' + CSS + "</style>"));
    var b = el('<div id="sudSyncB" title="Sync between Super Admin devices"><i></i><span>☁ Sync</span></div>');
    b.onclick = panel; document.body.appendChild(b); badge();
  }
  function badge() {
    var b = document.getElementById("sudSyncB"); if (!b) return;
    var i = b.querySelector("i"), s = b.querySelector("span");
    if (!on()) { i.className = ""; s.textContent = "☁ Sync: off"; b.title = "Sync between Super Admin devices"; return; }
    if (cfg.pending) { i.className = "wait"; s.textContent = "☁ Waiting for approval"; b.title = "Approve this device from your Super Admin device: ☁ Sync ▸ Devices"; return; }
    if (lastErr) { i.className = "err"; s.textContent = "☁ Sync problem"; b.title = lastErr; return; }
    i.className = (dirty.size || flushing || pulling) ? "busy" : "ok";
    s.textContent = pend ? "☁ " + pend + " device waiting" : dirty.size ? "☁ Saving…" : "☁ Synced" + (lastOk ? " " + new Date(lastOk).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "");
    b.title = "Live sync is on (" + (cfg.name || "this device") + ")";
  }
  function banner(msg, warn, reload) {
    if (!document.body) return;
    var o = document.getElementById("sudSyncN"); if (o) o.remove();
    var n = el('<div id="sudSyncN"' + (warn ? ' class="w"' : "") + '><span></span>' + (reload ? "<button>Reload now</button>" : "") + '<button class="x">✕</button></div>');
    n.querySelector("span").textContent = msg;
    if (reload) n.querySelector("button").onclick = function () { flush().then(function () { location.reload(); }); };
    n.querySelector(".x").onclick = function () { n.remove(); };
    document.body.appendChild(n);
  }
  var ago = function (t) { if (!t) return "—"; var m = Math.round((Date.now() - t) / 60000); return m < 6 ? "online now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " day(s) ago"; };
  async function devList(box) {
    box.innerHTML = '<div class="m">Loading devices…</div>';
    try {
      var r = await api("devices"), html = "";
      r.devices.forEach(function (d) {
        var tag = d.st === "wait" ? "⏳ Waiting for approval" : d.st === "wipe" ? "🧹 Will be erased" : "✅ Approved";
        html += '<div class="dv' + (d.st === "wait" ? " w" : "") + '"><b>' + esc(d.n) + "</b>" + (d.me ? " (this device)" : "") + (d.own ? " · main" : "") +
          "<br>" + tag + " · " + (d.st === "wait" ? "asked " + new Date(d.at).toLocaleString("en-IN") : "last seen " + ago(d.seen)) +
          (d.me ? "" : "<br>" + (d.st === "wait" ? '<button class="s" data-ap="' + d.id + '">✔ Approve</button><button class="s g" data-rm="' + d.id + '">✖ Refuse</button>'
            : d.own || d.st === "wipe" ? "" : '<button class="s g" data-rm="' + d.id + '">Remove</button><button class="s r" data-wp="' + d.id + '">Remove + erase its data</button>')) + "</div>";
      });
      box.innerHTML = html || '<div class="m">No devices</div>';
      var act = async function (a, id, extra, q) {
        if (q && !confirm(q)) return;
        try { await api(a, Object.assign({ target: id }, extra || {})); } catch (e) { alert(e.message); }
        devList(box); tick();
      };
      box.querySelectorAll("[data-ap]").forEach(function (b) { b.onclick = function () { var n = b.closest(".dv").querySelector("b").textContent; act("approve", b.dataset.ap, null, "Approve \"" + n + "\"?\n\nIt will get ALL Super Admin data (settings, cases, Google Sheet link, .exe licences). Approve only a device that you control."); }; });
      box.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = function () { act("remove", b.dataset.rm, null, "Remove this device from sync? It stops getting new data at once."); }; });
      box.querySelectorAll("[data-wp]").forEach(function (b) { b.onclick = function () { act("remove", b.dataset.wp, { wipe: 1 }, "Remove this device AND erase all SudarshanAshtra data on it (cases, settings, Super Admin key) the next time it is online?\n\nUse this for a lost laptop or a device that should no longer have access."); }; });
    } catch (e) { box.innerHTML = '<div class="m e"></div>'; box.firstChild.textContent = e.message; }
  }
  function panel() {
    var o = document.getElementById("sudSyncP"); if (o) return void o.remove();
    if (!isAdmin()) return;
    var p = el('<div id="sudSyncP"></div>');
    if (on() && cfg.pending) {
      p.innerHTML = '<h4>⏳ Waiting for approval</h4><div class="m">This device (<b></b>) has asked to join. On your main Super Admin device open <b>☁ Sync ▸ Devices</b> and press <b>✔ Approve</b>. This page checks every 15 seconds.</div>' +
        '<button id="ssNow">Check now</button><button class="g" id="ssOff">Cancel request</button><button class="g" id="ssX">Close</button>';
      p.querySelector(".m b").textContent = cfg.name;
      p.querySelector("#ssNow").onclick = async function () { this.disabled = true; await tick(); p.remove(); panel(); };
      p.querySelector("#ssOff").onclick = function () { cfg.on = false; cfg.pending = false; sv(LSC, cfg); clearTimeout(pt); p.remove(); badge(); };
    } else if (on()) {
      p.innerHTML = '<h4>☁ Live Sync – ON</h4><div class="m">This device: <b></b><br>Last sync: <span></span> · Waiting to send: <span></span></div><div class="m e"></div>' +
        '<h5>📱 Devices allowed to use the Super Admin portal</h5><div id="ssDev"></div>' +
        '<button id="ssNow">Sync now</button><button class="g" id="ssOff">Turn off here</button><button class="g" id="ssX">Close</button>';
      var m = p.querySelectorAll(".m b, .m span");
      m[0].textContent = cfg.name; m[1].textContent = lastOk ? new Date(lastOk).toLocaleTimeString("en-IN") : "—"; m[2].textContent = dirty.size + " item(s)";
      p.querySelector(".e").textContent = lastErr ? "Problem: " + lastErr : "";
      devList(p.querySelector("#ssDev"));
      p.querySelector("#ssNow").onclick = async function () { this.disabled = true; await tick(); p.remove(); panel(); };
      p.querySelector("#ssOff").onclick = function () { if (!confirm("Stop syncing on this device? Data already here stays here.")) return; cfg.on = false; sv(LSC, cfg); clearTimeout(pt); p.remove(); badge(); };
    } else {
      p.innerHTML = '<h4>☁ Live Sync – Super Admin devices</h4><div class="m">Use the Super Admin portal on more than one device. The first device becomes the main one; every other device must be approved from an approved device. Use the SAME URL and SAME passphrase everywhere.</div>' +
        '<label>Sync Apps Script URL</label><input id="ssU" placeholder="https://script.google.com/macros/s/…/exec">' +
        '<label>Sync passphrase (min 10 characters – keep it secret)</label><input id="ssP" type="password">' +
        '<label>Name of this device</label><input id="ssN" placeholder="e.g. Office PC / Laptop">' +
        '<div class="m e" id="ssE"></div><button id="ssGo">Connect</button><button class="g" id="ssX">Close</button>';
      if (cfg) { p.querySelector("#ssU").value = cfg.url || ""; p.querySelector("#ssN").value = cfg.name || ""; }
      p.querySelector("#ssGo").onclick = async function () {
        var u = p.querySelector("#ssU").value.trim(), pw = p.querySelector("#ssP").value, nm = p.querySelector("#ssN").value.trim() || "Device", e = p.querySelector("#ssE"), btn = this;
        e.textContent = "";
        if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return void (e.textContent = "Paste the Web app URL from Apps Script ▸ Deploy");
        if (pw.length < 10) return void (e.textContent = "Passphrase must be at least 10 characters");
        btn.disabled = true; e.textContent = "Connecting…";
        try { var msg = await connect(u, pw, nm); p.remove(); banner(msg, false, /Reload/.test(msg)); badge(); }
        catch (x) { e.textContent = x.message; btn.disabled = false; }
      };
    }
    p.querySelector("#ssX").onclick = function () { p.remove(); };
    document.body.appendChild(p);
  }

  /* ---------- connecting a device ---------- */
  async function connect(url, pass, name) {
    if (!isAdmin()) throw new Error("Only the Super Admin can turn on sync");
    var prev = cfg; cfg = { url: url, pass: pass, name: name, on: false }; K = await derive(pass);
    try {
      var h = await api("hello");
      if (!h.claimed) {                                         // first device → main Super Admin device
        await api("claim");
        st.seq = 0; sv(LSS, st); dirty.clear();
        (await ikeys()).forEach(function (k) { if (typeof k === "string" && !EXCL.test(k)) dirty.add(k); });
        cfg.on = true; sv(LSC, cfg); hook(); await flush(); if (lastErr) throw new Error(lastErr); loop();
        return "✅ Sync is on. This is now the MAIN Super Admin device. To add another device, connect it with the same URL and passphrase, then approve it here (☁ Sync ▸ Devices).";
      }
      if (!h.auth) throw new Error("Wrong passphrase for this sync server");
      var j = await api("join");
      cfg.on = true; cfg.pending = j.st !== "ok"; sv(LSC, cfg); hook();
      if (!cfg.pending) { await finishJoin(true); return "✅ Connected. Reload, then log in with the SAME password as your other Super Admin device."; }
      loop();
      return "⏳ Request sent. On your main Super Admin device open ☁ Sync ▸ Devices and press ✔ Approve for \"" + name + "\". This device will get the data as soon as it is approved.";
    } catch (e) { if (!cfg || !cfg.on) { cfg = prev; } throw e; }
  }
  async function finishJoin(silent) {
    cfg.pending = false; sv(LSC, cfg);
    var local = (await ikeys()).filter(function (k) { return typeof k === "string" && !EXCL.test(k); });
    var r = await api("pull", { since: 0 }), remote = new Set(r.ch.filter(function (c) { return !c.x; }).map(function (c) { return c.k; }));
    st.seq = 0; sv(LSS, st); dirty.clear();
    await pull(true); if (lastErr) throw new Error(lastErr);
    local.forEach(function (k) { if (!remote.has(k)) dirty.add(k); });
    await flush(); loop(); badge();
    if (!silent) { if (atLogin()) location.reload(); else banner("✅ This device was approved and now has the Super Admin data. Reload, then log in with the SAME password as your main device.", false, true); }
  }

  /* ---------- start (only for the Super Admin) ---------- */
  async function gate() {
    var admin = isAdmin(), b = document.getElementById("sudSyncB");
    if (!admin) { if (b) b.remove(); var p = document.getElementById("sudSyncP"); if (p) p.remove(); clearTimeout(pt); started = false; return; }
    ui();
    if (started || booting) return;
    if (cfg && cfg.on && cfg.pass) {
      booting = true;
      try { K = K || await derive(cfg.pass); hook(); started = true; badge(); await tick(); loop(); }
      catch (e) { await fail(e); } finally { booting = false; badge(); }
    } else started = true;
  }
  window.SudSync = { tick: tick, flush: flush, pull: pull, open: panel, status: function () { return { admin: isAdmin(), on: on(), pending: !!(cfg && cfg.pending), seq: st.seq, waitingDevices: pend, pendingItems: dirty.size, lastOk: lastOk, err: lastErr }; } };
  hook();
  setInterval(gate, 2000);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", gate); else gate();
})();
