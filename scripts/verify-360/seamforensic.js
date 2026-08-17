/**
 * seamforensic.js — PHASE 2/3 cubemap orientation forensics.
 *
 * Method (corrected after earlier quarter-tile confusion):
 *  - Uses level-2 tiles ONLY (1×1 per face = the full 512px face). Comparing
 *    full faces avoids every previous cross-level/quarter-tile pitfall.
 *  - For each of the 12 geometric seam pairs (the CUBE_FACES adjacency), and
 *    for all 64 combinations of the 8 square symmetries applied to faces A
 *    and B, computes the luminance correlation of the two seam strips
 *    (max of forward/reverse parity — seam direction parity is irrelevant
 *    visually).
 *  - Per-face implied transform is read across a face's 4 seams; a
 *    consistent per-face transform set (all scenes) is the provider
 *    convention; inconsistency within one scene only = content defect.
 *  - Inside-face verticality: Sobel gradient orientation histograms per
 *    face; agreement across faces validates cube orientation; uniform
 *    offset across all faces = source capture tilt.
 */
const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.APP_URL || "http://localhost:8000";

const SCENES = [
  ["36C2700C_2387_11BE_4188_8FE1A1518355", "boys_hostel"],
  ["94652D98_145D_D693_419A_9AE6E084796B", "central_library"],
  ["1FF19650_B610_DD8A_41C8_F03127ADA2BB", "auditorium"],
  ["376DF872_2734_77E8_41BE_53A2EB32FDD1", "main_gate"],
  ["1FF1BDF7_B611_4E76_41E0_09F5FAE2913E", "tech_park"],
  ["78E1DFC8_2754_4938_41AE_01C343A2EAB6", "univ_building"],
  ["73C4F6A7_6046_5D8D_41B3_CEA0E6CA64A4", "hitech_block"],
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  for (const [mediaId, tag] of SCENES) {
    const res = await page.evaluate(async ({ mediaId, baseURL }) => {
      // ---- load the six FULL faces (level 2 single tiles) ----
      const F = ["f", "r", "l", "b", "u", "d"];
      const W = 512;
      const px = {};
      for (const k of F) {
        const r = await fetch(`${baseURL}/api/panorama/tile/${mediaId}/${k}/2/0_0.jpg`);
        if (!r.ok) return { fail: `${k} HTTP ${r.status}` };
        const bmp = await createImageBitmap(await r.blob());
        if (bmp.width !== 512 || bmp.height !== 512) return { fail: `${k} dim ${bmp.width}` };
        const c = document.createElement("canvas");
        c.width = c.height = 64; // downscale once for seam strips
        c.getContext("2d").drawImage(bmp, 0, 0, 64, 64);
        px[k] = Array.from(c.getContext("2d").getImageData(0, 0, 64, 64).data);
      }
      const S = 64;
      const lum = (k, u, v) => {
        const i = (((1 - v) * (S - 1)) | 0) * S + ((u * (S - 1)) | 0);
        const j = i * 4;
        return 0.2126 * px[k][j] + 0.7152 * px[k][j + 1] + 0.0722 * px[k][j + 2];
      };
      // The 8 square symmetries on (u,v) ∈ [0,1]².
      const T = {
        id: (u, v) => [u, v],
        r90: (u, v) => [1 - v, u], // 90° CW
        r180: (u, v) => [1 - u, 1 - v],
        r270: (u, v) => [v, 1 - u], // 90° CCW
        fh: (u, v) => [1 - u, v], // mirror left-right
        fv: (u, v) => [u, 1 - v], // mirror top-bottom
        fh90: (u, v) => [v, u], // mirror along main diagonal
        fv90: (u, v) => [1 - v, 1 - u], // mirror along anti-diagonal
      };
      const TN = Object.keys(T);
      const edges = {
        // world edge: (face, edgeName) pairs in CUBE_FACES basis
        "f.right-r.left": [["f", "right"], ["r", "left"]],
        "f.left-l.right": [["f", "left"], ["l", "right"]],
        "b.left-r.right": [["b", "left"], ["r", "right"]],
        "b.right-l.left": [["b", "right"], ["l", "left"]],
        "f.top-u.bottom": [["f", "top"], ["u", "bottom"]],
        "r.top-u.right": [["r", "top"], ["u", "right"]],
        "b.top-u.front": [["b", "top"], ["u", "front"]],
        "l.top-u.left": [["l", "top"], ["u", "left"]],
        "f.bottom-d.front": [["f", "bottom"], ["d", "front"]],
        "r.bottom-d.right": [["r", "bottom"], ["d", "right"]],
        "b.bottom-d.back": [["b", "bottom"], ["d", "back"]],
        "l.bottom-d.left": [["l", "bottom"], ["d", "left"]],
      };
      // (u,v) parametrization of each face edge: value ranges over the edge.
      const EDGE = (face, eName) => {
        // returns f(t) t∈[0,1] → [u, v]
        const E = {
          right: (t) => [1, t], left: (t) => [0, t],
          top: (t) => [t, 1], bottom: (t) => [t, 0],
        };
        // Named edges of u/d that share world lines with ring faces:
        const UD = {
          "u.bottom": (t) => [t, 0], // pairs f.top (both run -x? f.top: x inc => (x,1,1); u.bottom: v=-1 => P=(x,1,1); param t along x both)
          "u.right": (t) => [1, t],
          "u.front": (t) => [t, 1],
          "u.left": (t) => [0, t],
          "d.front": (t) => [t, 1],
          "d.right": (t) => [1, t],
          "d.back": (t) => [t, 0],
          "d.left": (t) => [0, t],
        };
        const k = `${face}.${eName}`;
        return UD[k] ?? E[eName];
      };
      const corr = (a, b) => {
        const n = a.length;
        const m1 = a.reduce((s, x) => s + x, 0) / n, m2 = b.reduce((s, x) => s + x, 0) / n;
        let c = 0, d1 = 0, d2 = 0;
        for (let i = 0; i < n; i++) { c += (a[i] - m1) * (b[i] - m2); d1 += (a[i] - m1) ** 2; d2 += (b[i] - m2) ** 2; }
        return d1 && d2 ? c / Math.sqrt(d1 * d2) : 0;
      };
      const strip = (face, eName, tr, reverse) => {
        const f = EDGE(face, eName);
        const out = [];
        const N = 32;
        for (let i = 0; i <= N; i++) {
          let t = i / N;
          if (reverse) t = 1 - t;
          const [u, v] = f(t);
          const [tu, tv] = T[tr](u, v);
          out.push(lum(face, tu, tv));
        }
        return out;
      };
      const result = {};
      for (const [name, [pairA, pairB]] of Object.entries(edges)) {
        const [fa, ea] = pairA, [fb, eb] = pairB;
        // geometric orientation of B relative to A along the shared line:
        // determined once via the basis — vertical edges run +v(+y), and
        // horizontal edges run +u of the RING-ish face ... compute directly:
        // direction of A's edge in world = cross of its param axis; easiest:
        // sample the edge points at t=0 and t=1 and compare with B's.
        // We simply try both parities and keep max (parity is not visual).
        let best = { r: -2, ta: "id", tb: "id" };
        for (const ta of TN) for (const tb of TN) {
          const fwd = corr(strip(fa, ea, ta, false), strip(fb, eb, tb, false));
          const rev = corr(strip(fa, ea, ta, false), strip(fb, eb, tb, true));
          const r = Math.max(fwd, rev);
          if (r > best.r) best = { r, ta, tb };
        }
        result[name] = best;
      }
      // ---- inside-face verticality: gradient orientation histogram ----
      const G = 128;
      const histo = {};
      for (const k of F) {
        const c = document.createElement("canvas");
        c.width = c.height = G;
        c.getContext("2d").drawImage(await createImageBitmap(await (await fetch(`${baseURL}/api/panorama/tile/${mediaId}/${k}/2/0_0.jpg`)).blob()), 0, 0, G, G);
        const im = c.getContext("2d").getImageData(0, 0, G, G).data;
        const b = new Float32Array(G * G);
        for (let i = 0; i < G * G; i++) b[i] = im[i * 4] * 0.299 + im[i * 4 + 1] * 0.587 + im[i * 4 + 2] * 0.114;
        const bins = new Float64Array(180);
        for (let y = 1; y < G - 1; y++)
          for (let x = 1; x < G - 1; x++) {
            const gx = b[y * G + x + 1] - b[y * G + x - 1];
            const gy = b[(y + 1) * G + x] - b[(y - 1) * G + x];
            const m = Math.hypot(gx, gy);
            if (m < 12) continue;
            const ang = (Math.atan2(gy, gx) * 180) / Math.PI; // -180..180
            const norm = ((ang % 180) + 180) % 180; // 0 = horizontal, 90 = vertical
            bins[norm | 0] += m;
          }
        // dominant histogram peak | second peak
        let b1 = 0, b2 = 0;
        for (let i = 0; i < 180; i++) { if (bins[i] > bins[b1]) { b2 = b1; b1 = i; } else if (bins[i] > bins[b2] && i !== b1) b2 = i; }
        histo[k] = { dom: b1, dom2: b2, frac: +((bins[b1] + bins[b2]) / bins.reduce((s, x) => s + x, 0)).toFixed(2) };
      }
      return { seams: result, histo };
    }, { mediaId, baseURL: BASE });

    if (res.fail) { console.log(`\n== ${tag} == FAIL ${res.fail}`); continue; }
    console.log(`\n== ${tag} == (level-2 full faces, best of 64 transform combos per seam)`);
    const seams = res.seams;
    // per-face implied transform frequency
    const implied = {};
    const tally = (face, t) => { implied[face] ||= {}; implied[face][t] = (implied[face][t] || 0) + 1; };
    for (const [name, { r, ta, tb }] of Object.entries(seams)) {
      console.log(`   ${name.padEnd(22)} r=${r.toFixed(3)}  A:${ta.padEnd(4)} B:${tb}`);
      const [a, b] = name.split(".")[0] === "f" || name.split(".")[0] === "r" || name.split(".")[0] === "b" || name.split(".")[0] === "l"
        ? [name.split("-")[0].split(".")[0], name.split("-")[1].split(".")[0]] : [name.split("-")[0].split(".")[0], name.split("-")[1].split(".")[0]];
      tally(a, ta); tally(b, tb);
    }
    console.log("   per-face implied transforms:");
    for (const [f, m] of Object.entries(implied)) {
      const s = Object.entries(m).sort((x, y) => y[1] - x[1]);
      console.log(`     ${f}: ${s.map(([t, n]) => `${t}×${n}`).join("  ")}`);
    }
    console.log("   inside-face gradient orientation peaks (°; 90 = vertical):");
    for (const [k, h] of Object.entries(res.histo)) {
      console.log(`     ${k}: dom=${h.dom}  second=${h.dom2}  frac=${h.frac}`);
    }
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });