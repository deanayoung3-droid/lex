import { getSettings } from "@/lib/settings";

// Lex's embed script, for your website (any site that can add a script tag: Framer, Webflow,
// WordPress, your own):
//   <script src="https://lex.example.com/lex.js" defer></script>
// It docks Lex in the bottom-right corner of the page: a text box (an iframe of /chat)
// that grows into a frosted glass chat in the same corner. It tells the agent which page the visitor is on and its sections, notices
// when the visitor lingers on something (so the agent can offer a question about it), and carries
// out the agent's actions: scroll to a section, or move to another page of the same site (the chat
// reopens there, mid-conversation).
// Host page API: Lex("open") · Lex("close") · Lex("ask", "Do you integrate with Slack?")
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const s = await getSettings();
  if (!s.enabled) {
    return new Response("/* Lex is turned off. Turn it on in the admin. */", {
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=60" },
    });
  }
  const config = { origin, name: s.agentName || "Lex" };
  const js = `(function () {
  if (window.__lex) return;
  window.__lex = true;
  var C = ${JSON.stringify(config)};
  var P = "lex:";
  var KEY = "lex-open";
  var expanded = false;
  var ready = false;
  var barHeight = 84;
  var chatHeight = 380;
  // Lex isn't shown on phones: the bar would cover too much of a small screen.
  var phone = function () { return window.matchMedia("(max-width: 767px)").matches; };
  var lexScrollUntil = 0, lastPageScroll = 0; // Lex's own scrolling isn't the visitor scrolling
  var clean = function (s) { return String(s || "").replace(/\\s+/g, " ").trim(); };

  var frame = document.createElement("iframe");
  frame.title = C.name;
  frame.src = C.origin + "/chat?host=" + encodeURIComponent(location.origin);
  frame.setAttribute("allow", "clipboard-write");
  frame.setAttribute("allowtransparency", "true");

  // Collapsed, the frame is just the text box (with room for its shadow) in the bottom-right corner;
  // expanded, it's the chat in the same corner, and the frame itself blurs the page behind it.
  // Switching between the two, the frame fades and grows out of the corner at its new size (blur
  // and all), so neither change is a jump; the chat fades out first when it closes (see "closing").
  // The box's own size changes (a suggestion appearing above it) are instant, so the suggestion's
  // animation is what the visitor sees. Size updates only ever touch the frame's size; the fade and
  // lift are separate, so the several size reports that arrive while the chat opens don't cut its
  // animation short. The collapsed frame has 12px of room around the box, so both sit 24px in.
  var EASE = "cubic-bezier(.22,1,.36,1)";
  frame.style.cssText = "position:fixed;border:0;z-index:2147483000;background:transparent;color-scheme:normal;opacity:1;transform:none;transform-origin:100% 100%;";
  function place(animate) {
    var st = frame.style, blur = expanded ? "blur(28px) saturate(1.7)" : "";
    st.display = phone() ? "none" : "";
    st.right = (expanded ? 24 : 12) + "px";
    st.bottom = (expanded ? 20 : 8) + "px";
    st.width = expanded ? "min(420px, calc(100vw - 48px))" : "min(400px, calc(100vw - 24px))";
    st.height = (expanded ? Math.max(300, Math.min(chatHeight, 640, window.innerHeight - 40)) : barHeight) + "px";
    st.borderRadius = expanded ? "24px" : "";
    st.webkitBackdropFilter = blur;
    st.backdropFilter = blur;
    st.boxShadow = expanded ? "0 30px 70px -20px rgba(10,13,18,.36),0 10px 26px -12px rgba(10,13,18,.2),0 1px 3px rgba(10,13,18,.06)" : "";
    var motion = "opacity .2s ease-out,transform .34s " + EASE + (expanded ? ",height .22s " + EASE : "");
    if (!animate) {
      if (st.opacity !== "0") st.transition = motion; // a fade-out in progress keeps its own timing
      return;
    }
    st.transition = "none";
    st.opacity = "0";
    st.transform = "translateY(" + (expanded ? 12 : 8) + "px) scale(" + (expanded ? 0.96 : 0.99) + ")";
    void frame.offsetHeight; // start from there
    st.transition = motion;
    st.opacity = "1";
    st.transform = "none";
  }
  function fadeOut() {
    frame.style.transition = "opacity .16s ease-in,transform .17s ease-in";
    frame.style.opacity = "0";
    frame.style.transform = "translateY(10px) scale(.96)";
  }
  function post(msg) { if (ready && frame.contentWindow) frame.contentWindow.postMessage(msg, C.origin); }

  // The page as the agent sees it: where the visitor is, and the sections it can scroll to.
  function headings() {
    var out = [], seen = {}, els = document.querySelectorAll("h1,h2,h3");
    for (var i = 0; i < els.length && out.length < 40; i++) {
      var t = clean(els[i].textContent);
      if (t.length > 1 && t.length < 120 && !seen[t] && els[i].getClientRects().length) { seen[t] = 1; out.push(t); }
    }
    return out;
  }
  function sendPage() { post({ type: P + "page", page: { url: location.href.split("#")[0], title: document.title, headings: headings() } }); }

  function norm(s) { return clean(s).toLowerCase(); }
  function scrollTo(heading) {
    var want = norm(heading), els = document.querySelectorAll("h1,h2,h3,h4"), hit = null;
    for (var i = 0; i < els.length && !hit; i++) if (norm(els[i].textContent) === want) hit = els[i];
    for (var j = 0; j < els.length && !hit; j++) if (norm(els[j].textContent).indexOf(want) >= 0) hit = els[j];
    if (!hit) return;
    lexScrollUntil = Date.now() + 1500;
    window.scrollTo({ top: Math.max(0, hit.getBoundingClientRect().top + window.scrollY - 96), behavior: "smooth" });
    var box = hit.closest("section") || hit, before = box.style.boxShadow;
    box.style.transition = "box-shadow .3s ease";
    box.style.boxShadow = "0 0 0 3px rgba(10,13,18,.5)";
    setTimeout(function () { box.style.boxShadow = before; }, 1800);
  }

  // Only pages of this website; the chat stays closed on the new page (the conversation is kept,
  // one click away on the bar). A link to the page the visitor is already on scrolls instead: to its
  // section, or back to the top, and the chat steps aside.
  function go(href) {
    try {
      var u = new URL(href, location.href);
      if (location.host.replace(/^www\\./, "") !== u.host.replace(/^www\\./, "") || !/^https?:$/.test(u.protocol)) return;
      if (u.pathname.replace(/\\/$/, "") === location.pathname.replace(/\\/$/, "") && u.search === location.search) {
        var target = u.hash && document.getElementById(decodeURIComponent(u.hash.slice(1)));
        lexScrollUntil = Date.now() + 1500;
        window.scrollTo({ top: target ? Math.max(0, target.getBoundingClientRect().top + window.scrollY - 96) : 0, behavior: "smooth" });
        post({ type: P + "expand", open: false });
        return;
      }
      try { sessionStorage.setItem(KEY, ""); } catch (e) {}
      location.href = u.toString();
    } catch (e) {}
  }

  // Lingering: the pointer resting on something (a third of a second, so passing over doesn't
  // count), or one section staying in view, tells the agent what the visitor is looking at, so it
  // can offer the question written for that section at once. Moving into another section offers
  // that section's question. Never in the site's own menus or footer, never while the chat is open
  // or on a phone; the same section again only after a few seconds.
  var HOVER_MS = 300, VIEW_MS = 3000, SAME_MS = 8000, lastDwell = 0, lastHeading = null, hoverEl = null, hoverTimer = 0, viewTimer = 0;
  function headingAbove(y) {
    var hs = document.querySelectorAll("h1,h2,h3"), best = null;
    for (var i = 0; i < hs.length; i++) { var r = hs[i].getBoundingClientRect(); if (r.height && r.top <= y + 4) best = hs[i]; }
    return best ? clean(best.textContent).slice(0, 120) : "";
  }
  function targetText(el) {
    var t = el.closest("a,button,[role=button],li,h1,h2,h3,h4,p,figure,img") || el;
    var s = t.tagName === "IMG" ? t.getAttribute("alt") : t.textContent;
    s = clean(s);
    return s.length > 2 ? s.slice(0, 120) : "";
  }
  function dwell(kind, el) {
    if (!ready || expanded || phone()) return;
    if (el && el.closest("nav,header,footer,[role=navigation]")) return;
    var heading = el ? headingAbove(el.getBoundingClientRect().top) : headingAbove(window.innerHeight * 0.45);
    var target = el ? targetText(el) : "";
    if (target === heading) target = "";
    if (!heading && !target) return;
    if (heading === lastHeading && Date.now() - lastDwell < SAME_MS) return;
    lastHeading = heading;
    lastDwell = Date.now();
    post({ type: P + "dwell", kind: kind, heading: heading, target: target });
  }
  document.addEventListener("mouseover", function (e) {
    var el = e.target;
    if (!(el instanceof Element) || el === hoverEl) return;
    hoverEl = el;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { dwell("hover", el); }, HOVER_MS);
  }, { passive: true });
  document.documentElement.addEventListener("mouseleave", function () { clearTimeout(hoverTimer); hoverEl = null; });
  function watchView() { clearTimeout(viewTimer); viewTimer = setTimeout(function () { dwell("view", null); }, VIEW_MS); }
  // The visitor scrolling the page tells an answered chat to step aside (the chat decides).
  window.addEventListener("scroll", function () {
    clearTimeout(hoverTimer); hoverEl = null; watchView();
    var now = Date.now();
    if (expanded && ready && now > lexScrollUntil && now - lastPageScroll > 400) { lastPageScroll = now; post({ type: P + "pagescroll" }); }
  }, { passive: true });

  window.addEventListener("message", function (e) {
    if (e.origin !== C.origin || e.source !== frame.contentWindow || !e.data || typeof e.data !== "object") return;
    var t = String(e.data.type || "");
    if (t === P + "ready") {
      ready = true;
      sendPage();
      var reopen = false;
      try { reopen = sessionStorage.getItem(KEY) === "1"; } catch (x) {}
      if (reopen) post({ type: P + "expand", open: true });
      watchView();
    } else if (t === P + "closing") fadeOut();
    else if (t === P + "reshow") place(true); // reopened before it finished closing
    else if (t === P + "size") {
      var was = expanded;
      expanded = Boolean(e.data.expanded);
      if (!expanded && e.data.height > 0) barHeight = Math.min(Number(e.data.height), 400);
      if (expanded && e.data.height > 0) chatHeight = Number(e.data.height);
      // The frame reports its (collapsed) size before it's ready; only remember open or closed
      // after that, or a chat that should reopen on this page would forget to.
      if (ready) { try { sessionStorage.setItem(KEY, expanded ? "1" : ""); } catch (x) {} }
      if (expanded) sendPage();
      place(was !== expanded);
    } else if (t === P + "scroll") scrollTo(e.data.heading);
    else if (t === P + "navigate") go(e.data.url);
  });
  function refit() { if (mounted) place(false); else mount(); }
  window.addEventListener("resize", refit);
  try { window.matchMedia("(max-width: 767px)").addEventListener("change", refit); } catch (e) {}
  // Single-page sites change pages without a reload; tell the agent where the visitor went.
  var lastUrl = location.href;
  setInterval(function () { if (location.href !== lastUrl) { lastUrl = location.href; sendPage(); } }, 1000);

  function api(cmd, arg) {
    if (cmd === "open") post({ type: P + "expand", open: true });
    else if (cmd === "close") post({ type: P + "expand", open: false });
    else if (cmd === "toggle") post({ type: P + "expand", open: !expanded });
    else if (cmd === "ask" && arg) post({ type: P + "ask", question: String(arg).slice(0, 1000) });
  }
  var queued = (window.Lex && window.Lex.q) || [];
  window.Lex = api;

  var mounted = false;
  function mount() {
    // On a phone, nothing loads until the window is wide enough (a desktop window resized back up).
    if (mounted || phone()) return;
    mounted = true;
    place(false);
    document.body.appendChild(frame);
    var wait = setInterval(function () { if (ready) { clearInterval(wait); for (var i = 0; i < queued.length; i++) api.apply(null, queued[i]); } }, 200);
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();`;
  return new Response(js, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
