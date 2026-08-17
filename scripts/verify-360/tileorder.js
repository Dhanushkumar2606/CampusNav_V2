/**
 * tileorder.js — decisive experiment for multi-tile level assembly order
 * (runs inside headless Chrome: createImageBitmap/OffscreenCanvas).
 * Level 2 = single full 512px face. Level 1 = 2×2 tiles of 512px each.
 * Correlates the L2 face against every plausible L1 tile permutation —
 * the ≈1.0 permutation is the provider's true layout.
 */
const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.APP_URL || "http://localhost:5173/api/panorama/tile";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto(BASE.replace("/api/panorama/tile", ""), { waitUntil: "domcontentloaded" });

  const mediaIds = {
    boys_hostel: "36C2700C_2387_11BE_4188_8FE1A1518355",
    central_library: "94652D98_145D_D693_419A_9AE6E084796B",
    auditorium: "1FF19650_B610_DD8A_41C8_F03127ADA2BB",
  };
  const faces = ["f", "r", "u", "d", "l", "b"];

  for (const [tag, mid] of Object.entries(mediaIds)) {
    const out = await page.evaluate(async ({ baseURL, mid, faces }) => {
      const grab = async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bmp = await createImageBitmap(await r.blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        c.getContext("2d").drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, data: c.getContext("2d").getImageData(0, 0, bmp.width, bmp.height).data };
      };
      const lum = (d, w, x, y) => {
        const i = (Math.min(w - 1, y | 0) * w + Math.min(w - 1, x | 0)) * 4;
        return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      };
      const corr = (a, b) => {
        const n = a.length;
        const m1 = a.reduce((s, x) => s + x, 0) / n, m2 = b.reduce((s, x) => s + x, 0) / n;
        let c = 0, d1 = 0, d2 = 0;
        for (let i = 0; i < n; i++) { c += (a[i] - m1) * (b[i] - m2); d1 += (a[i] - m1) ** 2; d2 += (b[i] - m2) ** 2; }
        return d1 && d2 ? c / Math.sqrt(d1 * d2) : 0;
      };

      const res = {};
      for (const f of faces) {
        const l2 = await grab(`${baseURL}/${mid}/${f}/2/0_0.jpg`);
        const S = 128, S2 = 256;
        const ref256 = [];
        for (let py = 0; py < S2; py++)
          for (let px = 0; px < S2; px++)
            ref256.push(lum(l2.data, l2.w, (px / S2) * l2.w, (py / S2) * l2.h));

        const ts = {};
        for (let r = 0; r < 2; r++)
          for (let c = 0; c < 2; c++) ts[`${r}${c}`] = await grab(`${baseURL}/${mid}/${f}/1/${r}_${c}.jpg`);

        const tileLum = (g) => {
          const out = [];
          for (let y = 0; y < S; y++)
            for (let x = 0; x < S; x++)
              out.push(lum(g.data, g.w, (x / S) * g.w, (y / S) * g.h));
          return out;
        };
        const tl = {};
        for (const k of Object.keys(ts)) tl[k] = tileLum(ts[k]);

        const candidates = {
          as_is: [["00", "01"], ["10", "11"]],
          col_swap: [["01", "00"], ["11", "10"]],
          row_swap: [["10", "11"], ["00", "01"]],
          both_swap: [["11", "10"], ["01", "00"]],
          transpose: [["00", "10"], ["01", "11"]],
          transpose_flip: [["10", "00"], ["11", "01"]],
        };
        let best = { name: "", r: -2 };
        for (const [name, grid] of Object.entries(candidates)) {
          const assembled = [];
          for (let py = 0; py < S2; py++) {
            const R = py >> 7, ly = py & 127;
            for (let px = 0; px < S2; px++) {
              const C = px >> 7, lx = px & 127;
              assembled.push(tl[grid[R][C]][ly * S + lx]);
            }
          }
          const r = corr(ref256, assembled);
          if (r > best.r) best = { name, r };
        }
        res[f] = `${best.name} r=${best.r.toFixed(4)}`;
      }
      return res;
    }, { baseURL: BASE, mid, faces });

    console.log(`\n== ${tag} ==`);
    for (const [f, v] of Object.entries(out)) console.log(`  ${f}: ${v}`);
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });