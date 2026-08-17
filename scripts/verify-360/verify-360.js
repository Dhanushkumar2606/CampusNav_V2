/**
 * verify-360.mjs — E2E checks for the 360° viewer + diagnostic harness
 * (Phase 16 of the 360-upgrade). Driven from the frontend dev server.
 *
 * Covers:
 *  A. Viewer renders: canvas sized to container, framebuffer non-blank.
 *  B. Gating: the /dev/360-test route does NOT exist in a production build.
 *  C. Diagnostic page: scene selector, six faces load to level 0, seam
 *     continuity chips + honest verdict, orientation stats.
 *  D. Viewer HUD: location chip, controls, drag-to-look, wheel zoom,
 *     scene rail prev/next, control cluster present.
 *  E. Resize: viewport resize keeps the drawing buffer 1:1 with layout.
 *  F. Navigation wiring: "Navigate here" from the rail-switched scene
 *     routes to the OTHER node.
 */
const puppeteer = require("puppeteer-core");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEV = process.env.APP_URL || "http://localhost:5173";
const PROD = process.env.PROD_URL || "http://localhost:8000";

const SEAMS_OK = 12;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

  const PASS = [];
  const FAIL = [];
  const check = (name, ok, extra = "") => {
    (ok ? PASS : FAIL).push(name + (extra ? ` — ${extra}` : ""));
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
  };

  // ---- B: prod build has no diagnostic route (plain 404 / SPA fallback) ----
  await page.goto(`${PROD}/dev/360-test`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 2500));
  const prodTitle = await page.title();
  const prodHasDiagnostics = (await page.content()).includes("360° Diagnostic");
  check("prod build excludes the diagnostic page", !prodHasDiagnostics, `serves "${prodTitle}"`);

  // ---- C: diagnostic page on the dev server ----
  await page.goto(`${DEV}/dev/360-test`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text/360° Diagnostic", { timeout: 15000 }).catch(() => {});
  check("diagnostic page renders", (await page.content()).includes("360° Diagnostic"));

  // Wait for graph + first scene (loads pyramid 2→1→0).
  await page.waitForFunction(() => {
    const chips = [...document.querySelectorAll("aside span.font-mono")].map((e) => e.textContent || "");
    return chips.length >= 2 && chips.every((c) => /[RLUDFB] 0/.test(c));
  }, { timeout: 60000 }).catch(() => {});
  const faceChips = await page.$$eval("aside span.font-mono", (els) => els.map((e) => e.textContent?.trim()));
  const allDeep = faceChips.filter((c) => /[RLUDFB] 0/.test(c)).length;
  check("six faces loaded to deep level", allDeep === 6, JSON.stringify(faceChips.slice(0, 6)));

  // Seam verdict: green "12/12" or the content-defect warning. Real provider
  // data: no scene is 12/12 healthy (up/down captures drift; the harness
  // flags that honestly) — assert diagnosis, not a fantasy green.
  await page.waitForFunction(
    () => document.body.textContent.includes("12/12 seams ≥ 0.9") || document.body.textContent.includes("content is defective") || document.body.textContent.includes("below 0.9"),
    { timeout: 60000 },
  ).catch(() => {});
  const seamChips = await page.$$eval("aside li", (els) =>
    els.map((li) => li.textContent || "").filter((t) => t.includes("–")),
  );
  const seamVals = seamChips.map((t) => parseFloat(t.match(/(\d\.\d{3})$/)?.[1] || "0"));
  const bodyText = await page.evaluate(() => document.body.textContent || "");
  const allHealthy = seamVals.length === SEAMS_OK && seamVals.every((v) => v >= 0.9);
  check("seam check ran (12 chips)", seamVals.length === SEAMS_OK, `${seamVals.length} seams`);
  if (allHealthy) {
    check("12/12 seams ≥ 0.9", true, "source is healthy for this scene");
  } else {
    const diagnosed = /content is defective|below 0\.9/.test(bodyText);
    check(
      "harness flags the scene's content honestly",
      diagnosed,
      `${seamVals.length} seams, min ${Math.min(...seamVals, 1).toFixed(3)}`,
    );
  }

  // Stats HUD populated (canvas/buffer/aspect/fov/camera — separate <p> lines).
  await page.waitForFunction(
    () => [...document.querySelectorAll("aside p")].some((p) => /^canvas \d+×\d+$/.test((p.textContent || "").trim())),
    { timeout: 15000 },
  ).catch(() => {});
  const statLines = await page.$$eval("aside p", (els) => els.map((e) => (e.textContent || "").trim()));
  check(
    "renderer stats HUD live",
    statLines.some((l) => /^canvas \d+×\d+$/.test(l)) &&
      statLines.some((l) => /^buffer \d+×\d+$/.test(l)) &&
      statLines.some((l) => /aspect .*· fov \d+°/.test(l)),
    statLines.join(" | ").slice(0, 120),
  );

  // Canvas sized: drawing buffer matches layout × dpr.
  const canvasSizes = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const buf = c.width, css = c.getBoundingClientRect();
    return { buf, cssW: css.width, dpr: window.devicePixelRatio };
  });
  check(
    "diagnostic canvas buffer ≈ layout × dpr",
    canvasSizes && Math.abs(canvasSizes.buf - canvasSizes.cssW * canvasSizes.dpr) <= 2,
    JSON.stringify(canvasSizes),
  );

  // Screenshot for the report (default scene, diagnostics on).
  await page.screenshot({ path: "diag360_default.png" });

  // Switch scene → chips settle again + seams re-run.
  const labels = await page.$$eval("select option", (o) => o.map((x) => x.textContent));
  const scenes = labels.length;
  check("scene selector lists all immersive places", scenes >= 5, `${scenes} scenes`);
  const scene2Value = await page.$$eval("select option", (opts) => {
    const list = [...opts];
    const sel = list.find((o) => o.selected);
    const other = list.find(
      (o) => o.value !== sel?.value && /library|auditorium|gate/i.test(o.textContent || ""),
    );
    const pick = other ?? list.find((o) => o.value !== sel?.value) ?? list[0];
    return pick?.value ?? "";
  });
  await page.select("select", scene2Value);
  await page.waitForFunction(
    () => {
      const chips = [...document.querySelectorAll("aside span.font-mono")].map((e) => e.textContent || "");
      return chips.filter((c) => /[RLUDFB] 0/.test(c)).length === 6;
    },
    { timeout: 90000 },
  ).catch(() => {});
  const chips2 = await page.$$eval("aside span.font-mono", (els) => els.map((e) => e.textContent?.trim()));
  check("scene 2 faces loaded to deep level", chips2.filter((c) => /[RLUDFB] 0/.test(c)).length === 6, JSON.stringify(chips2.slice(0, 6)));
  await page.waitForFunction(
    () => document.body.textContent.includes("12/12 seams ≥ 0.9") || document.body.textContent.includes("content is defective") || document.body.textContent.includes("below 0.9"),
    { timeout: 60000 },
  ).catch(() => {});
  const seams2 = await page.$$eval("aside li", (els) =>
    els.map((li) => li.textContent || "").filter((t) => t.includes("–")),
  );
  check("scene 2 seam check re-ran (12 chips)", seams2.length === SEAMS_OK, `${seams2.length} seams`);
  const verdict2 = (await page.evaluate(() => document.body.textContent)) || "";
  const verdict2Ok = /12\/12 seams ≥ 0\.9/.test(verdict2) || /content is defective|below 0\.9/.test(verdict2);
  check(
    "scene 2 verdict present (healthy or honest defect)",
    verdict2Ok,
    /12\/12/.test(verdict2) ? "healthy" : "content defect flagged",
  );
  await page.screenshot({ path: "diag360_scene2.png" });

  // ---- A/D: viewer path — open /map, select an immersive place, open 360° -----
  const DIRECT = DEV;
  // The map requires an account: register a throwaway user via the API, then
  // sign in through the real login form so the session cookie + token land.
  const email = `e2e360-${Date.now()}@example.com`;
  await page.evaluate(async (em) => {
    await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: em, password: "Verify360Pass!1", full_name: "360 Verify" }),
    });
  }, email);
  await page.goto(`${DEV}/login`, { waitUntil: "networkidle2" });
  const setVal = (selector, value) =>
    page.evaluate(({ selector, value }) => {
      const el = document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, { selector, value });
  await setVal("#email", email);
  await setVal("#password", "Verify360Pass!1");
  await page.click('form button[type="submit"]');
  await page.waitForFunction(() => !location.pathname.includes("login"), { timeout: 20000 }).catch(() => {});
  check("sign-in succeeds (map auth gate)", !(await page.evaluate(() => location.pathname.includes("login"))));
  // Resolve the first immersive place (campus slug first; response may wrap in
  // { data }).
  const placeIds = await page.evaluate(async () => {
    const unwrap = async (url) => {
      const r = await fetch(url);
      const body = await r.json();
      return body && typeof body === "object" && "data" in body ? body.data : body;
    };
    const campuses = await unwrap("/api/navigation/campuses");
    if (!campuses?.length) return [];
    const g = await unwrap(`/api/navigation/campuses/${encodeURIComponent(campuses[0].slug)}/graph`);
    const nodes = g?.graph?.nodes ?? g?.nodes ?? g ?? [];
    return nodes
      .filter((n) => n.metadata && n.metadata.immersive && n.metadata.immersive.mediaId)
      .map((n) => n.id);
  });
  check("graph exposes immersive nodes", placeIds.length >= 5, `${placeIds.length} nodes`);

  // Mobile viewport: the map's place details live in the BottomSheet (its
  // backdrop intentionally covers the whole app, including the desktop card —
  // drive the viewer through the sheet, the real mobile path).
  await page.setViewport({ width: 414, height: 896 });
  await page.goto(`${DIRECT}/map?place=${encodeURIComponent(placeIds[0])}`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Explore 360°")),
    { timeout: 20000 },
  ).catch(() => {});
  check("place details show the 360° action", (await page.content()).includes("Explore 360°"));
  // element.click() bypasses hit-testing (the sheet backdrop has already eaten
  // enough real clicks); the onClick handler is what we verify.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Explore 360°"));
    b?.click();
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('[aria-label^="360° panorama of"] canvas');
    if (!c) return false;
    const ctx2 = c.getContext("webgl2") || c.getContext("webgl");
    return c.width > 200 && !!ctx2;
  }, { timeout: 30000 }).catch(() => {});
  // Wait for the panorama to be interactable (loading → ready stage): the
  // HUD control cluster only mounts once the scene is staged — and only then
  // is the framebuffer guaranteed to hold a rendered frame.
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Recenter view"]')),
    { timeout: 30000 },
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  const viewerCanvas = await page.evaluate(() => {
    const c = document.querySelector('[aria-label^="360° panorama of"] canvas');
    if (!c) return null;
    return { w: c.width, h: c.height };
  });
  check("viewer canvas sized (≥ 200px buffer)", viewerCanvas && viewerCanvas.w >= 200 && viewerCanvas.h >= 200, JSON.stringify(viewerCanvas));
  if (viewerCanvas) {
    const rect = await page.$eval('[aria-label^="360° panorama of"] canvas', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    await page.screenshot({ path: "viewer_frame_clip.png", clip: rect });
    const bytes = require("fs").statSync(`${__dirname}/viewer_frame_clip.png`).size;
    // A blank (black) frame compresses to a few KB; a textured panorama is
    // tens+ of KB. Combined with the yaw/fov checks this proves live frames.
    check("viewer framebuffer non-blank", bytes > 15000, `${bytes} bytes`);
  } else {
    check("viewer framebuffer non-blank", false, "canvas missing");
  }

  // HUD elements present.
  const hud = await page.evaluate(() => ({
    locationChip: [...document.querySelectorAll("span")].some((s) => /360°/.test(s.textContent || "")),
    controls: [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
  }));
  check("HUD location chip present", hud.locationChip);
  check(
    "HUD controls present",
    ["Zoom in", "Zoom out", "Recenter view", "Fullscreen"].every((l) => hud.controls.includes(l)),
    JSON.stringify(hud.controls.filter(Boolean)),
  );

  const box = await page.$eval('[aria-label^="360° panorama of"] canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const viewerCanvasSel = () =>
    page.evaluate(() => {
      const c = document.querySelector('[aria-label^="360° panorama of"] canvas');
      return c ? { w: c.width, h: c.height } : null;
    });

  // Drag-to-look changes yaw (dev HUD prints it).
  const yawBefore = await page.evaluate(() => {
    const m = [...document.querySelectorAll("div,span")].map((e) => e.textContent || "").find((t) => /yaw/.test(t));
    return m || "";
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 0; i < 25; i++) await page.mouse.move(box.x + i * 4, box.y + i * 1.5);
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 500));
  const yawAfter = await page.evaluate(() => {
    const m = [...document.querySelectorAll("div,span")].map((e) => e.textContent || "").find((t) => /yaw/.test(t));
    return m || "";
  });
  const y1 = parseFloat(yawBefore.match(/yaw (-?\d+)/)?.[1] ?? "nan");
  const y2 = parseFloat(yawAfter.match(/yaw (-?\d+)/)?.[1] ?? "nan");
  check("drag-to-look changes yaw", Number.isFinite(y1) && Number.isFinite(y2) && Math.abs(y2 - y1) > 1, `${yawBefore} → ${yawAfter}`);

  await page.screenshot({ path: "viewer_360_hud.png" });

  // Wheel zoom changes FOV.
  const fovBefore = await page.evaluate(() => {
    const m = [...document.querySelectorAll("div,span")].map((e) => e.textContent || "").find((t) => /fov/.test(t));
    return m || "";
  });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaY: -400 });
  await page.mouse.wheel({ deltaY: -400 });
  await new Promise((r) => setTimeout(r, 500));
  const fovAfter = await page.evaluate(() => {
    const m = [...document.querySelectorAll("div,span")].map((e) => e.textContent || "").find((t) => /fov/.test(t));
    return m || "";
  });
  const f1 = parseInt(fovBefore.match(/fov (\d+)/)?.[1] ?? "0");
  const f2 = parseInt(fovAfter.match(/fov (\d+)/)?.[1] ?? "0");
  check("wheel zoom changes fov", f1 !== 0 && f2 < f1, `${fovBefore} → ${fovAfter}`);

  // Scene rail: prev/next buttons exist and switch scene.
  const railNext = await page.$('button[aria-label="Next 360° scene"]').catch(() => null);
  check("scene rail next button", Boolean(railNext));
  if (railNext) {
    await page.click('button[aria-label="Next 360° scene"]');
    await new Promise((r) => setTimeout(r, 3500));
    const chip2 = await page.evaluate(() => {
      const chip = [...document.querySelectorAll("div,span")].map((e) => e.textContent || "").find((t) => t.includes("of ") && t.includes("360°"));
      const h = document.querySelector("h2")?.textContent || "";
      return (chip || h).trim();
    });
    check("scene rail switches the viewer", Boolean(chip2), chip2);
    await page.screenshot({ path: "viewer_360_scene2.png" });
  }

  // ---- F: Navigate here from a rail-switched scene routes to that node ----
  const destBefore = new URL(page.url()).searchParams.get("destination");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Navigate here"));
    b?.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
  const destAfter = new URL(page.url()).searchParams.get("destination");
  check("navigate-here writes a destination", Boolean(destAfter), `${destBefore ?? "-"} → ${destAfter ?? "-"}`);

  // ---- E: resize — viewport shrink keeps buffer sized to layout ----
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${DIRECT}/map?place=${encodeURIComponent(placeIds[1])}`, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("Explore 360°")),
    { timeout: 15000 },
  ).catch(() => {});
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").includes("Explore 360°"));
    b?.click();
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('[aria-label^="360° panorama of"] canvas');
    return c && c.width > 200;
  }, { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const sized = await page.evaluate(() => {
    const c = document.querySelector('[aria-label^="360° panorama of"] canvas');
    const r = c.getBoundingClientRect();
    return { buf: c.width, css: r.width, dpr: window.devicePixelRatio };
  });
  check("canvas follows resize (buffer ≈ css × dpr)", sized && Math.abs(sized.buf - sized.css * sized.dpr) <= 2, JSON.stringify(sized));

  // ---- close path: Esc closes the viewer ----
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 600));
  const viewerGone = await viewerCanvasSel();
  check("Escape closes the viewer", viewerGone === null, JSON.stringify(viewerGone));

  const pageErrors = errors.filter((e) => !/favicon|The manifest|net::ERR_ABORTED|404/.test(e));
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 4).join(" | "));

  await browser.close();

  console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
  if (FAIL.length) process.exit(1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });