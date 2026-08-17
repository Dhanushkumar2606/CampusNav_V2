/** isolate.js — pin down the L1-vs-L2 seam divergence:
 *  (a) original forensic port on level-2 single tiles (direct 512→64),
 *  (b) same on level-2 via the 1024 intermediate,
 *  (c) level-1 assembled, and
 *  (d) per-L1-tile quadrant localization against the L2 face (all 24 perms).
 */
const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:5173/api/panorama/tile";
const SCENES = { central_library: "94652D98_145D_D693_419A_9AE6E084796B", arch_gate: "376DF872_2734_77E8_41BE_53A2EB32FDD1" };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("http://localhost:5173", { waitUntil: "domcontentloaded" });

  const probe = page.evaluate.bind(page, async ({ mediaId, baseURL }) => {
    const F = ["f", "r", "l", "b", "u", "d"];
    const fetchTile = async (face, level, t) => {
      const r = await fetch(`${baseURL}/${mediaId}/${face}/${level}/${t}.jpg`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await createImageBitmap(await r.blob());
    };
    const lum64 = (data) => {
      const out = new Float64Array(64 * 64);
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4;
          out[y * 64 + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
      return out;
    };
    const down64 = (bmp) => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      c.getContext("2d").drawImage(bmp, 0, 0, 64, 64);
      return lum64(c.getContext("2d").getImageData(0, 0, 64, 64).data);
    };
    const down64via1024 = (bmp) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1024;
      c.getContext("2d").drawImage(bmp, 0, 0, 1024, 1024);
      const d = document.createElement("canvas");
      d.width = d.height = 64;
      d.getContext("2d").drawImage(c, 0, 0, 64, 64);
      return lum64(d.getContext("2d").getImageData(0, 0, 64, 64).data);
    };
    const assembleL1 = async (face) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1024;
      const ctx = c.getContext("2d");
      for (const t of ["0_0", "1_0", "0_1", "1_1"]) {
        const col = parseInt(t[0]), row = parseInt(t[2]);
        ctx.drawImage(await fetchTile(face, 1, t), col * 512, row * 512, 512, 512);
      }
      const d = document.createElement("canvas");
      d.width = d.height = 64;
      d.getContext("2d").drawImage(c, 0, 0, 64, 64);
      return lum64(d.getContext("2d").getImageData(0, 0, 64, 64).data);
    };
    const corr = (a, b) => {
      let m1 = 0, m2 = 0, c = 0, d1 = 0, d2 = 0;
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) { m1 += a[i]; m2 += b[i]; }
      m1 /= n; m2 /= n;
      for (let i = 0; i < n; i++) { c += (a[i] - m1) * (b[i] - m2); d1 += (a[i] - m1) ** 2; d2 += (b[i] - m2) ** 2; }
      return d1 && d2 ? c / Math.sqrt(d1 * d2) : 0;
    };
    // 64×64 luma → 32×32 by 2×2 block means (matches quadrant resolution).
    const subsample32 = (a) => {
      const out = new Float64Array(32 * 32);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          let s = 0;
          for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) s += a[(y * 2 + dy) * 64 + (x * 2 + dx)];
          out[y * 32 + x] = s / 4;
        }
      return out;
    };

    // --- seam method (verbatim forensic) on a 64px lum grid ---
    const seamsOf = (lumOf) => {
      const S = 64;
      const T = {
        id: (u, v) => [u, v], r90: (u, v) => [1 - v, u], r180: (u, v) => [1 - u, 1 - v], r270: (u, v) => [v, 1 - u],
        fh: (u, v) => [1 - u, v], fv: (u, v) => [u, 1 - v], fh90: (u, v) => [v, u], fv90: (u, v) => [1 - v, 1 - u],
      };
      const TN = Object.keys(T);
      const EDGE = (face, eName) => {
        const E = { right: (t) => [1, t], left: (t) => [0, t], top: (t) => [t, 1], bottom: (t) => [t, 0] };
        const UD = {
          "u.bottom": (t) => [t, 0], "u.right": (t) => [1, t], "u.front": (t) => [t, 1], "u.left": (t) => [0, t],
          "d.front": (t) => [t, 1], "d.right": (t) => [1, t], "d.back": (t) => [t, 0], "d.left": (t) => [0, t],
        };
        return UD[`${face}.${eName}`] || E[eName];
      };
      const strip = (face, eName, tr, rev) => {
        const f = EDGE(face, eName);
        const out = [];
        for (let i = 0; i <= 32; i++) {
          let t = i / 32;
          if (rev) t = 1 - t;
          const [u, v] = f(t);
          const [tu, tv] = T[tr](u, v);
          const bi = (((1 - tv) * (S - 1)) | 0) * S + ((tu * (S - 1)) | 0);
          out.push(lumOf[face][bi]);
        }
        return out;
      };
      const edges = [
        ["f.right-r.left", ["f", "right"], ["r", "left"]], ["f.left-l.right", ["f", "left"], ["l", "right"]],
        ["b.left-r.right", ["b", "left"], ["r", "right"]], ["b.right-l.left", ["b", "right"], ["l", "left"]],
        ["f.top-u.bottom", ["f", "top"], ["u", "bottom"]], ["r.top-u.right", ["r", "top"], ["u", "right"]],
        ["b.top-u.front", ["b", "top"], ["u", "front"]], ["l.top-u.left", ["l", "top"], ["u", "left"]],
        ["f.bottom-d.front", ["f", "bottom"], ["d", "front"]], ["r.bottom-d.right", ["r", "bottom"], ["d", "right"]],
        ["b.bottom-d.back", ["b", "bottom"], ["d", "back"]], ["l.bottom-d.left", ["l", "bottom"], ["d", "left"]],
      ];
      const out = {};
      for (const [name, [fa, ea], [fb, eb]] of edges) {
        let best = -2;
        for (const ta of TN) for (const tb of TN) {
          const fwd = corr(strip(fa, ea, ta, false), strip(fb, eb, tb, false));
          const rev = corr(strip(fa, ea, ta, false), strip(fb, eb, tb, true));
          best = Math.max(best, fwd, rev);
        }
        out[name] = +best.toFixed(3);
      }
      return out;
    };

    // (d) per-tile localization: each of the 4 L1 tiles vs the L2 face quadrants.
    const localize = async (face) => {
      const l2 = await down64(await fetchTile(face, 2, "0_0"));
      const l1tiles = { "0_0": await fetchTile(face, 1, "0_0"), "1_0": await fetchTile(face, 1, "1_0"), "0_1": await fetchTile(face, 1, "0_1"), "1_1": await fetchTile(face, 1, "1_1") };
      const quadrant = (q) => {
        const sub = new Float64Array(32 * 32);
        for (let y = 0; y < 32; y++)
          for (let x = 0; x < 32; x++) {
            const sy = q >> 1, sx = q & 1;
            sub[y * 32 + x] = l2[(sy * 32 + y) * 64 + (sx * 32 + x)];
          }
        return sub;
      };
      const bestOfTile = async (bmp) => {
        const tile = subsample32(await down64(bmp));
        let best = { q: -1, r: -2 };
        for (let q = 0; q < 4; q++) {
          const r = corr(tile, quadrant(q));
          if (r > best.r) best = { q, r };
        }
        return best;
      };
      const out = {};
      for (const [t, bmp] of Object.entries(l1tiles)) {
        const b = await bestOfTile(bmp);
        out[t] = `q${b.q} r=${b.r.toFixed(3)}`;
      }
      return out;
    };

    // Run all three seam pipelines + localization.
    const l2Direct = {}, l2Via1024 = {}, l1 = {};
    for (const face of F) {
      const b2 = await fetchTile(face, 2, "0_0");
      l2Direct[face] = down64(b2);
      l2Via1024[face] = down64via1024(b2);
      l1[face] = await assembleL1(face);
    }
    const res = {};
    res.l2_direct = seamsOf(l2Direct);
    res.l2_via_1024 = seamsOf(l2Via1024);
    res.l1_assembled = seamsOf(l1);
    res.localize_f = await localize("f");
    return res;
  });

  for (const [tag, mid] of Object.entries(SCENES)) {
    console.log(`\n== ${tag} ==`);
    const res = await probe({ mediaId: mid, baseURL: BASE });
    for (const [key, seams] of Object.entries(res)) {
      if (key === "localize_f") { console.log(`  localize face f:`); for (const [t, v] of Object.entries(seams)) console.log(`    tile ${t} → ${v}`); continue; }
      const vals = Object.values(seams);
      const weak = Object.entries(seams).filter(([, v]) => v < 0.9).map(([k, v]) => `${k}:${v.toFixed(3)}`);
      console.log(`  ${key}: min ${Math.min(...vals).toFixed(3)} max ${Math.max(...vals).toFixed(3)} mean ${(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3)}${weak.length ? ` WEAK(${weak.length}): ${weak.slice(0, 4).join(" ")}` : ""}`);
    }
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });