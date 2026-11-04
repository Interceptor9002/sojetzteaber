const KORB = "https://korb.rk/jar";
const KORB_DEV = "https://korb.rk/dev";
const KORB_PK = "https://korb.rk/pk";
const SITZ = "_limebike-web_session";
const DROSSEL = [429, 502, 503, 504, 521];
const BUDGET = 22000;
const MAX = 3;

const APP = {
  "user-agent": "Lime/3.149.0 (iPhone; iOS 17.5; Scale/3.00)",
  "platform": "iOS",
  "app-version": "3.149.0",
  "accept-language": "de-DE,de;q=0.9,en;q=0.8"
};

const BROWSER = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "de-DE,de;q=0.9,en-US;q=0.7",
  "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
};

async function hole(schluessel){
  try {
    const c = await caches.default.match(new Request(schluessel));
    return c ? (await c.text()) : "";
  } catch(_){ return "" }
}

async function lege(schluessel, text, sekunden){
  if (!text) return;
  try {
    await caches.default.put(new Request(schluessel), new Response(text, {
      headers: { "content-type":"text/plain", "cache-control":"max-age=" + sekunden }
    }));
  } catch(_){}
}

async function geraet(){
  let d = await hole(KORB_DEV);
  if (d && d.length === 36) return d;
  d = crypto.randomUUID();
  await lege(KORB_DEV, d, 31536000);
  return d;
}

async function korbSchreiben(res){
  let liste = [];
  try { liste = res.headers.getSetCookie() } catch(_){}
  if (!liste || !liste.length) return;
  const alt = await hole(KORB);
  const map = {};
  alt.split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) map[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  let neu = false;
  liste.forEach(p => {
    const i = p.indexOf("=");
    if (i < 1) return;
    const name = p.slice(0, i).trim();
    const wert = p.slice(i + 1).split(";")[0].trim();
    if (!/session|lime/i.test(name)) return;
    if (map[name] !== wert) neu = true;
    map[name] = wert;
  });
  if (!neu && alt) return;
  const text = Object.keys(map).filter(k => map[k]).map(k => k + "=" + map[k]).join("; ");
  if (!text || text.length > 4000) return;
  await lege(KORB, text, 1800);
}

async function sitzung(frisch){
  if (!frisch){
    const alt = await hole(KORB);
    if (alt.indexOf(SITZ + "=") >= 0) return { jar: alt, quelle: "cache" };
  }
  const quelle = [
    "https://web-production.lime.bike/",
    "https://web-production.lime.bike/api/rider/v1/users/bootstrap?latitude=52.52&longitude=13.405",
    "https://web-production.lime.bike/api/rider/v2/app_state"
  ];
  for (const z of quelle){
    let r;
    try { r = await fetch(z, { headers: BROWSER, redirect:"follow" }) } catch(_){ continue }
    await korbSchreiben(r);
    const k = await hole(KORB);
    if (k.indexOf(SITZ + "=") >= 0) return { jar: k, quelle: new URL(z).pathname };
    if (r.status === 429) break;
  }
  return { jar: await hole(KORB), quelle: "keine" };
}

async function pkHolen(){
  const alt = await hole(KORB_PK);
  if (alt) return alt;
  try {
    const r = await fetch("https://web-production.lime.bike/", { headers: BROWSER, redirect:"follow" });
    const t = await r.text();
    const m = t.match(/pk_(live|test)_[A-Za-z0-9]{10,}/);
    if (m){ await lege(KORB_PK, m[0], 43200); return m[0] }
  } catch(_){}
  return "";
}

const KOPF_WEG = ["host","cf-connecting-ip","cf-ray","cf-visitor","x-forwarded-proto",
  "x-forwarded-for","origin","referer","accept-encoding","content-length","cookie",
  "sec-fetch-dest","sec-fetch-mode","sec-fetch-site","sec-ch-ua","sec-ch-ua-mobile",
  "sec-ch-ua-platform","upgrade-insecure-requests"];

export default {
  async fetch(req){
    const cors = {
      "access-control-allow-origin":"*",
      "access-control-allow-headers":"*",
      "access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-max-age":"86400",
      "access-control-expose-headers":"retry-after,x-rk-session,x-rk-try,x-rk-wait,x-rk-drossel,x-rk-src"
    };
    if (req.method === "OPTIONS") return new Response(null, { status:204, headers:cors });

    const u = new URL(req.url);

    if (u.searchParams.get("pk") === "1"){
      const pk = await pkHolen();
      return new Response(JSON.stringify({ pk }),
        { status: pk ? 200 : 404, headers:{ ...cors, "content-type":"application/json", "cache-control":"no-store" } });
    }

    if (u.searchParams.get("stripe") === "1"){
      const koerper = await req.text();
      let r;
      try {
        r = await fetch("https://api.stripe.com/v1/tokens", {
          method:"POST",
          headers:{ "content-type":"application/x-www-form-urlencoded", "accept":"application/json" },
          body: koerper
        });
      } catch(e){
        return new Response(JSON.stringify({ fehler:"stripe", detail:String(e) }),
          { status:502, headers:{ ...cors, "content-type":"application/json" } });
      }
      return new Response(await r.text(), {
        status:r.status,
        headers:{ ...cors, "content-type":"application/json", "cache-control":"no-store" }
      });
    }

    const ziel = u.searchParams.get("url");
    if (!ziel) return new Response(JSON.stringify({ fehler:"url fehlt" }),
      { status:400, headers:{ ...cors, "content-type":"application/json" } });

    let t;
    try { t = new URL(ziel) } catch(_){
      return new Response(JSON.stringify({ fehler:"url kaputt" }),
        { status:400, headers:{ ...cors, "content-type":"application/json" } });
    }

    const lime = /(^|\.)lime\.bike$/.test(t.hostname);
    const api = lime && t.pathname.indexOf("/api/") === 0;
    const meth = req.method;
    const koerper = (meth === "GET" || meth === "HEAD") ? undefined : await req.arrayBuffer();
    const kopf = {};
    req.headers.forEach((v, k) => { if (KOPF_WEG.indexOf(k) < 0) kopf[k] = v });

    if (lime){
      kopf["x-device-token"] = await geraet();
      kopf["platform"] = APP["platform"];
      kopf["app-version"] = APP["app-version"];
      kopf["accept-language"] = APP["accept-language"];
      if (api){
        kopf["accept"] = "application/json, text/plain, */*";
        kopf["user-agent"] = APP["user-agent"];
        kopf["origin"] = "https://web-production.lime.bike";
        kopf["referer"] = "https://web-production.lime.bike/";
      } else {
        kopf["accept"] = BROWSER["accept"];
        kopf["user-agent"] = BROWSER["user-agent"];
      }
    }

    let versuche = 0, gewartet = 0, drossel = false, quelle = "-";
    let res;
    while (true){
      versuche++;
      if (lime){
        const s = await sitzung(false);
        quelle = s.quelle;
        if (s.jar.indexOf(SITZ + "=") >= 0) kopf["cookie"] = s.jar;
        else delete kopf["cookie"];
      }
      try {
        res = await fetch(t.toString(), { method:meth, headers:kopf, body:koerper, redirect:"follow" });
      } catch(e){
        res = new Response(JSON.stringify({ fehler:"upstream", detail:String(e) }),
          { status:502, headers: { "content-type":"application/json" } });
      }
      if (lime) await korbSchreiben(res);
      if (!lime) break;
      if (DROSSEL.indexOf(res.status) < 0 || versuche >= MAX) break;
      drossel = true;
      const ra = parseInt(res.headers.get("retry-after") || "0", 10);
      const ms = ra > 0 ? Math.min(ra, 12) * 1000 : 2500 * versuche;
      if (gewartet + ms > BUDGET) break;
      gewartet += ms;
      await new Promise(r => setTimeout(r, ms));
      if (res.status === 429) await sitzung(true);
    }

    const raus = new Headers(res.headers);
    ["content-encoding","content-length","transfer-encoding","set-cookie","cache-control"].forEach(k => raus.delete(k));
    for (const k in cors) raus.set(k, cors[k]);
    raus.set("cache-control", "no-store");
    const jar = lime ? await hole(KORB) : "";
    raus.set("x-rk-session", lime ? (jar.indexOf(SITZ + "=") >= 0 ? "1" : "0") : "-");
    raus.set("x-rk-try", String(versuche));
    raus.set("x-rk-wait", String(Math.round(gewartet / 1000)));
    raus.set("x-rk-drossel", drossel ? "1" : "0");
    raus.set("x-rk-src", quelle);

    return new Response(res.body, { status:res.status, headers:raus });
  }
};