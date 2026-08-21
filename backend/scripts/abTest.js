// backend/scripts/abTest.js
// Claid vs Higgsfield A/B test: same input images, same prompts, front AND back.
//
// Usage:   node scripts/abTest.js [frontFilename] [backFilename]
//   Defaults to the newest *front* / *back* uploads in backend/uploads.
//
// Providers:
//   - Claid: uses IMAGE_API_KEY from backend/.env (the app's normal pipeline)
//   - Higgsfield Soul (via each::labs): uses EACHLABS_API_KEY from backend/.env.
//     If the key is missing, the Higgsfield side is skipped — you can also run
//     the same inputs/prompts manually at higgsfield.ai and drop results into
//     backend/uploads/abtest/ as higgsfield-manual-front.jpg and
//     higgsfield-manual-back.jpg (or .png); the page picks them up on re-run.
//
// Output: backend/uploads/abtest/index.html
//   View at http://localhost:3000/uploads/abtest/index.html while the app runs.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { uploadToClaid, runGenerationTask } = require("../imageGenClient");

const UPLOADS = path.join(__dirname, "..", "uploads");
const OUT_DIR = path.join(UPLOADS, "abtest");

// Same prompts the app uses (hooded, men's) and same background.
const MODEL_TERM = "male model";
const PROMPTS = {
  front: `fashion photography of ${MODEL_TERM}, waist up shot, torso only, no legs, focus on hoodie, hood down resting on shoulders, NOT on head, front view, preserve clothing details, sharp text, high fidelity texture`,
  back: `fashion photography of ${MODEL_TERM}, waist up shot, torso only, no legs, focus on hoodie, hood up on head, back view, preserve clothing details, high fidelity texture`,
};
const BACKGROUND = "very light grey professional studio background, hex color #F5F5F5, soft shadows";
const ASPECT = "3:4";

function newestUpload(pattern) {
  const files = fs.readdirSync(UPLOADS)
    .filter(f => pattern.test(f) && !f.startsWith("processed_") && /\.(jpe?g|png)$/i.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(UPLOADS, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0]?.f;
}

async function download(url, dest) {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(dest, res.data);
  return dest;
}

async function runClaid(view, inputUrl) {
  const t0 = Date.now();
  const resultUrl = await runGenerationTask(`AB_CLAID_${view.toUpperCase()}`, inputUrl, PROMPTS[view], BACKGROUND, ASPECT, process.env.IMAGE_API_KEY);
  const file = `claid-${view}.jpg`;
  await download(resultUrl, path.join(OUT_DIR, file));
  return { seconds: ((Date.now() - t0) / 1000).toFixed(0), file };
}

async function runHiggsfield(view, inputUrl) {
  const key = process.env.EACHLABS_API_KEY;
  if (!key) return { skipped: "EACHLABS_API_KEY not set in backend/.env" };

  const t0 = Date.now();
  const headers = { Authorization: `Bearer ${key}`, "X-API-Key": key, "Content-Type": "application/json" };

  const create = await axios.post("https://api.eachlabs.ai/v1/prediction/", {
    model: "higgsfield-ai-soul",
    version: "0.0.1",
    input: {
      prompt: PROMPTS[view] + ", " + BACKGROUND,
      image_url: inputUrl,
      aspect_ratio: "1152x1536", // ~3:4
      quality: "720p",
      batch_size: 1
    },
    webhook_url: ""
  }, { headers, validateStatus: () => true });

  if (create.status >= 400) {
    return { error: `each::labs create failed (${create.status}): ${JSON.stringify(create.data).slice(0, 500)}` };
  }

  const id = create.data?.predictionID || create.data?.id;
  if (!id) return { error: `No prediction id in response: ${JSON.stringify(create.data).slice(0, 300)}` };

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await axios.get(`https://api.eachlabs.ai/v1/prediction/${id}`, { headers, validateStatus: () => true });
    const status = (poll.data?.status || "").toLowerCase();
    console.log(`[AB_HIGGSFIELD_${view.toUpperCase()}] Poll ${i + 1}: ${status}`);
    if (["success", "succeeded", "completed"].includes(status)) {
      let out = poll.data.output;
      if (Array.isArray(out)) out = out[0];
      if (!out) return { error: "Succeeded but no output URL" };
      const file = `higgsfield-${view}.jpg`;
      await download(out, path.join(OUT_DIR, file));
      return { seconds: ((Date.now() - t0) / 1000).toFixed(0), file };
    }
    if (["failed", "error", "canceled"].includes(status)) {
      return { error: `Prediction failed: ${JSON.stringify(poll.data).slice(0, 500)}` };
    }
  }
  return { error: "Timed out waiting for Higgsfield result" };
}

function card(title, file, meta) {
  if (!file) {
    return `<div class="card"><h2>${title}</h2><div class="missing">${meta}</div></div>`;
  }
  return `<div class="card"><h2>${title}</h2><a href="${file}" target="_blank"><img src="${file}?${Date.now()}"></a><p>${meta || ""}</p></div>`;
}

function sectionHtml(view, results) {
  const manual = fs.readdirSync(OUT_DIR).find(f => new RegExp(`^higgsfield-manual-${view}\\.(jpe?g|png)$`, "i").test(f));
  const r = results[view];
  return `
<h2 class="section">${view.toUpperCase()}</h2>
<div class="prompt">PROMPT: ${PROMPTS[view]}\nBACKGROUND: ${BACKGROUND}</div>
<div class="grid">
${card("Input (preprocessed)", `input-${view}.jpg`, "What both providers received")}
${card("Claid", r.claid.file, r.claid.error || (r.claid.seconds ? r.claid.seconds + "s" : ""))}
${manual
    ? card("Higgsfield (manual run)", manual, "Generated by hand at higgsfield.ai with the same input/prompt")
    : card("Higgsfield Soul (each::labs)", r.higgsfield.file, r.higgsfield.error || r.higgsfield.skipped || (r.higgsfield.seconds ? r.higgsfield.seconds + "s" : ""))}
</div>`;
}

function writePage(results) {
  const html = `<!doctype html><meta charset="utf-8"><title>Claid vs Higgsfield</title>
<style>
body{font-family:system-ui;margin:2rem;background:#111;color:#eee}
h1{font-weight:600} h2.section{margin-top:2.5rem;border-bottom:1px solid #333;padding-bottom:.4rem}
.prompt{background:#222;padding:1rem;border-radius:8px;font-family:monospace;font-size:.85rem;margin-bottom:1.5rem;white-space:pre-wrap}
.grid{display:flex;gap:1.5rem;flex-wrap:wrap}
.card{flex:1;min-width:280px;max-width:450px;background:#1c1c1c;border-radius:12px;padding:1rem}
.card img{width:100%;border-radius:8px;cursor:zoom-in}
.card h2{margin:.2rem 0 .8rem;font-size:1.1rem}
.missing{padding:3rem 1rem;text-align:center;color:#888;border:1px dashed #444;border-radius:8px}
p{color:#aaa;font-size:.85rem}
.tip{margin-top:2rem;color:#888;font-size:.85rem}
</style>
<h1>Claid vs Higgsfield — same inputs, same prompts</h1>
${sectionHtml("front", results)}
${sectionHtml("back", results)}
<p class="tip">Click any image to open it full size — zoom into the print to judge the lettering. Re-run with: <code>node scripts/abTest.js</code></p>`;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
}

(async () => {
  const frontFile = process.argv[2] || newestUpload(/front/i);
  const backFile = process.argv[3] || newestUpload(/back/i);
  if (!frontFile || !backFile) throw new Error("Front or back image not found in uploads/. Pass filenames explicitly.");
  if (!process.env.IMAGE_API_KEY) throw new Error("IMAGE_API_KEY missing in backend/.env");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log("Front input:", frontFile);
  console.log("Back input:", backFile);

  // One upload per view, shared by both providers.
  const [frontUrl, backUrl] = await Promise.all([
    uploadToClaid(path.join(UPLOADS, frontFile), process.env.IMAGE_API_KEY),
    uploadToClaid(path.join(UPLOADS, backFile), process.env.IMAGE_API_KEY),
  ]);
  await Promise.all([
    download(frontUrl, path.join(OUT_DIR, "input-front.jpg")),
    download(backUrl, path.join(OUT_DIR, "input-back.jpg")),
  ]);

  console.log("Running Claid and Higgsfield (front + back) in parallel...");
  const [cf, cb, hf, hb] = await Promise.all([
    runClaid("front", frontUrl).catch(e => ({ error: e.message })),
    runClaid("back", backUrl).catch(e => ({ error: e.message })),
    runHiggsfield("front", frontUrl).catch(e => ({ error: e.message })),
    runHiggsfield("back", backUrl).catch(e => ({ error: e.message })),
  ]);

  const results = { front: { claid: cf, higgsfield: hf }, back: { claid: cb, higgsfield: hb } };
  console.log(JSON.stringify(results, null, 2));

  writePage(results);
  console.log("\nCompare page: http://localhost:3000/uploads/abtest/index.html");
})().catch(e => { console.error("A/B test failed:", e.message); process.exit(1); });
