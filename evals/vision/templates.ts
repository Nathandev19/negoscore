// Gabarits HTML des captures synthétiques. Style inspiré d'une messagerie
// mobile et d'un client mail mobile, sans logo ni marque réelle.

export type Degradation = "none" | "cut-bottom" | "low-quality" | "photo-of-screen";

export type DmSpec = {
  kind: "dm";
  handle: string;
  displayName: string;
  initials: string;
  avatarColors: [string, string];
  timestamp: string;
  bubbles: string[];
};

export type MailSpec = {
  kind: "mail";
  subject: string;
  senderName: string;
  senderEmail: string;
  initial: string;
  avatarColor: string;
  time: string;
  body: string;
};

export type ScreenSpec = (DmSpec | MailSpec) & { degradation: Degradation; height: number };

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const BASE_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font-family: "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.status { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; font-size: 15px; font-weight: 600; }
.status .icons { display: flex; gap: 6px; align-items: center; }
.bar { width: 18px; height: 10px; border: 1.5px solid currentColor; border-radius: 3px; position: relative; }
.bar::after { content: ""; position: absolute; inset: 1px 4px 1px 1px; background: currentColor; border-radius: 1px; }
.signal { display: flex; gap: 2px; align-items: flex-end; height: 11px; }
.signal i { width: 3px; background: currentColor; border-radius: 1px; display: block; }
`;

function statusBar(time: string): string {
  return `<div class="status"><span>${time}</span><span class="icons"><span class="signal"><i style="height:4px"></i><i style="height:6px"></i><i style="height:8px"></i><i style="height:11px"></i></span><span style="font-size:13px">5G</span><span class="bar"></span></span></div>`;
}

function dmScreen(spec: DmSpec): string {
  const bubbles = spec.bubbles
    .map((text, i) => {
      const last = i === spec.bubbles.length - 1;
      const avatar = last
        ? `<span class="mini" style="background:linear-gradient(135deg,${spec.avatarColors[0]},${spec.avatarColors[1]})">${spec.initials}</span>`
        : `<span class="mini ghost"></span>`;
      return `<div class="row">${avatar}<div class="bubble">${escapeHtml(text)}</div></div>`;
    })
    .join("");
  return `
<style>
.scr { background: #fff; color: #000; width: 390px; min-height: 100%; }
.head { display: flex; align-items: center; gap: 10px; padding: 6px 14px 10px; border-bottom: 1px solid #dbdbdb; }
.back { font-size: 26px; line-height: 1; margin-right: 4px; }
.avatar { width: 36px; height: 36px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 14px; display: grid; place-items: center; }
.who { flex: 1; line-height: 1.2; }
.who b { font-size: 16px; display: block; }
.who span { font-size: 12px; color: #737373; }
.actions { display: flex; gap: 18px; font-size: 20px; }
.profile { text-align: center; padding: 18px 0 8px; }
.profile .avatar { width: 84px; height: 84px; font-size: 30px; margin: 0 auto 8px; }
.profile b { display: block; font-size: 17px; }
.profile span { font-size: 13px; color: #737373; display: block; margin-top: 2px; }
.profile .btn { display: inline-block; margin-top: 10px; background: #efefef; border-radius: 8px; padding: 6px 14px; font-size: 13px; font-weight: 600; }
.stamp { text-align: center; font-size: 12px; color: #737373; margin: 18px 0 10px; font-weight: 600; }
.chat { padding: 0 12px 12px; }
.row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 3px; }
.mini { width: 28px; height: 28px; border-radius: 50%; flex: none; color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
.mini.ghost { background: transparent; }
.bubble { background: #efefef; border-radius: 20px; padding: 9px 13px; font-size: 15px; line-height: 1.35; max-width: 270px; }
.composer { position: fixed; left: 10px; right: 10px; bottom: 12px; height: 46px; border-radius: 23px; background: #efefef; display: flex; align-items: center; padding: 0 8px 0 6px; gap: 10px; font-size: 15px; color: #737373; }
.composer .cam { width: 34px; height: 34px; border-radius: 50%; background: #3797f0; }
</style>
${statusBar("14:32")}
<div class="head"><span class="back">‹</span><span class="avatar" style="background:linear-gradient(135deg,${spec.avatarColors[0]},${spec.avatarColors[1]})">${spec.initials}</span><span class="who"><b>${escapeHtml(spec.displayName)}</b><span>${escapeHtml(spec.handle)}</span></span><span class="actions"><span>✆</span><span>▭</span></span></div>
<div class="profile"><span class="avatar" style="background:linear-gradient(135deg,${spec.avatarColors[0]},${spec.avatarColors[1]})">${spec.initials}</span><b>${escapeHtml(spec.displayName)}</b><span>${escapeHtml(spec.handle)} · Compte professionnel</span><span class="btn">Voir le profil</span></div>
<div class="stamp">${escapeHtml(spec.timestamp)}</div>
<div class="chat">${bubbles}</div>
<div class="composer"><span class="cam"></span>Écrire un message…</div>`;
}

function mailScreen(spec: MailSpec): string {
  return `
<style>
.scr { background: #fff; color: #1f1f1f; width: 390px; min-height: 100%; }
.top { display: flex; align-items: center; justify-content: space-between; padding: 4px 16px 8px; font-size: 20px; color: #444; }
.top .right { display: flex; gap: 22px; }
.subject { font-size: 22px; line-height: 1.3; padding: 6px 16px 4px; font-weight: 400; }
.label { display: inline-block; font-size: 12px; background: #e8eaed; border-radius: 4px; padding: 1px 6px; margin-left: 6px; vertical-align: middle; color: #444; }
.sender { display: flex; align-items: center; gap: 12px; padding: 14px 16px 8px; }
.avatar { width: 40px; height: 40px; border-radius: 50%; color: #fff; font-size: 18px; display: grid; place-items: center; flex: none; }
.meta { flex: 1; line-height: 1.3; }
.meta b { font-size: 15px; font-weight: 600; }
.meta .time { font-size: 13px; color: #5f6368; margin-left: 6px; }
.meta .to { font-size: 13px; color: #5f6368; display: block; }
.meta .mail { font-size: 12px; color: #5f6368; }
.more { font-size: 20px; color: #5f6368; }
.body { padding: 4px 16px 24px; font-size: 15px; line-height: 1.5; }
.body p { margin: 0 0 12px; }
.reply { display: flex; gap: 10px; padding: 0 16px 20px; }
.reply span { flex: 1; border: 1px solid #c4c7c5; border-radius: 20px; text-align: center; padding: 9px 0; font-size: 14px; font-weight: 600; color: #444; }
</style>
${statusBar("10:42")}
<div class="top"><span>←</span><span class="right"><span>⤓</span><span>🗑</span><span>✉</span><span>⋮</span></span></div>
<div class="subject">${escapeHtml(spec.subject)}<span class="label">Boîte de réception</span></div>
<div class="sender"><span class="avatar" style="background:${spec.avatarColor}">${spec.initial}</span><span class="meta"><b>${escapeHtml(spec.senderName)}</b><span class="time">${spec.time}</span><span class="to">à moi ▾</span><span class="mail">${escapeHtml(spec.senderEmail)}</span></span><span class="more">↩ ⋮</span></div>
<div class="body">${paragraphs(spec.body)}</div>
<div class="reply"><span>↩ Répondre</span><span>↪ Transférer</span></div>`;
}

// Dégradations appliquées en CSS au moment du rendu.
function wrap(inner: string, spec: ScreenSpec): { html: string; width: number; height: number } {
  if (spec.degradation === "photo-of-screen") {
    const width = 900;
    const height = spec.height + 260;
    return {
      width,
      height,
      html: `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
body.desk { background: radial-gradient(ellipse at 30% 20%, #6b5b4e 0%, #3b312a 55%, #1d1814 100%); }
.stage { width: ${width}px; height: ${height}px; display: grid; place-items: center; }
/* Transformations 2D : le rendu 3D sans GPU coupe le plan en headless. */
.phone { position: relative; width: 414px; padding: 12px; border-radius: 46px; background: #111; box-shadow: 0 40px 80px rgba(0,0,0,.55); transform: rotate(-8deg) skewX(-6deg) skewY(3deg) scale(1.05); }
.screen { position: relative; width: 390px; height: ${spec.height}px; overflow: hidden; border-radius: 34px; background: #fff; filter: brightness(.93) contrast(.92) saturate(.85) blur(.45px); }
.glare { position: absolute; inset: 0; pointer-events: none; border-radius: 34px; background:
  linear-gradient(118deg, rgba(255,255,255,0) 18%, rgba(255,255,255,.55) 30%, rgba(255,255,255,.18) 38%, rgba(255,255,255,0) 50%),
  radial-gradient(ellipse at 78% 12%, rgba(255,250,235,.5), rgba(255,255,255,0) 40%); }
.moire { position: absolute; inset: 0; pointer-events: none; border-radius: 34px; opacity: .08; background: repeating-linear-gradient(0deg, #000 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, #000 0 1px, transparent 1px 3px); }
</style></head><body class="desk"><div class="stage"><div class="phone"><div class="screen">${inner}</div><div class="glare"></div><div class="moire"></div></div></div></body></html>`,
    };
  }

  const extra =
    spec.degradation === "low-quality"
      ? `.frame { filter: blur(1.1px) contrast(.55) brightness(1.12) saturate(.6); }`
      : "";
  // Coupe en bas : le bord inférieur de la capture tombe au milieu de la
  // dernière bulle ou du dernier paragraphe, calculé après mise en page.
  const cutScript =
    spec.degradation === "cut-bottom"
      ? `<script>
document.querySelectorAll(".composer, .reply").forEach((el) => el.remove());
const items = document.querySelectorAll(".bubble, .body p");
const last = items[items.length - 1];
const r = last.getBoundingClientRect();
const shift = ${spec.height} - Math.round(r.top + r.height * 0.45);
const content = document.querySelector(".content");
if (shift >= 0) {
  const spacer = document.createElement("div");
  spacer.style.height = shift + "px";
  const anchor = document.querySelector(".stamp, .sender");
  anchor.parentNode.insertBefore(spacer, anchor);
} else {
  content.style.marginTop = shift + "px";
}
</script>`
      : "";
  return {
    width: 390,
    height: spec.height,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.frame { position: relative; width: 390px; height: ${spec.height}px; overflow: hidden; background: #fff; }
${extra}</style></head><body><div class="frame"><div class="content">${inner}</div></div>${cutScript}</body></html>`,
  };
}

export function renderHtml(spec: ScreenSpec): { html: string; width: number; height: number } {
  const inner = `<div class="scr">${spec.kind === "dm" ? dmScreen(spec) : mailScreen(spec)}</div>`;
  return wrap(inner, spec);
}
