import { createHash, timingSafeEqual } from "node:crypto";

const API = "https://api.netlify.com/api/v1";
const hash = s => createHash("sha256").update(String(s)).digest();
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const { NETLIFY_TOKEN, SITE_ID, LAUNCH_PASSWORD } = process.env;
  if (!NETLIFY_TOKEN || !SITE_ID || !LAUNCH_PASSWORD)
    return json({ error: "The launcher is not configured yet. Ask your web developer." }, 500);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  if (!timingSafeEqual(hash(body.password ?? ""), hash(LAUNCH_PASSWORD))) {
    await new Promise(r => setTimeout(r, 1500)); // slows down guessing
    return json({ error: "Wrong password." }, 401);
  }

  const call = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { Authorization: "Bearer " + NETLIFY_TOKEN } });
    if (!r.ok) throw new Error("Netlify returned an error (" + r.status + ").");
    return r.json();
  };

  try {
    const site = await call("/sites/" + SITE_ID);
    const deploys = await call(`/sites/${SITE_ID}/deploys?per_page=20`);
    const target = deploys.find(d => d.state === "ready" && d.context === "production");
    const address = site.custom_domain ? "https://" + site.custom_domain : site.ssl_url;
    const live = !!target && site.published_deploy?.id === target.id;

    if (body.action === "launch") {
      if (!target) return json({ error: "There is no finished build to launch." }, 409);
      if (!live) await call(`/deploys/${target.id}/restore`, { method: "POST" });
      return json({ launched: true, address });
    }

    return json({
      ready: !!target, live, address,
      title: target?.title, created_at: target?.created_at, preview: target?.deploy_ssl_url
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};

export const config = { path: "/api/launch" };
