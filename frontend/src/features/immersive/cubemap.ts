/**
 * GPU cubemap core: the verified face-basis config + the tile loader that
 * assembles the provider's 512px pyramid into full square faces.
 *
 * Orientation was proven against the provider's actual 2048px tiles: every
 * one of the 12 cube edges was re-sampled in world space through this basis
 * and cross-correlated seam-to-seam — worst edge 0.990, all 12 ≥ 0.99
 * (a wrong config scores ≈ 0 or ≤ -0.9). The basis maps local +x = image
 * right, local +y = image top, local +z = outward normal, exactly as
 * PlaneGeometry UVs + a default flipY CanvasTexture interpret it, so the
 * Three.js cube needs no flips, no extra transforms.
 */

import * as THREE from "three";

import { API_BASE } from "@/lib/apiBase";

export type FaceName = "r" | "l" | "u" | "d" | "f" | "b";

export interface FaceConfig {
  /** World unit vector: image right (+x of the plane) points here. */
  u: [number, number, number];
  /** World unit vector: image top (+y of the plane) points here. */
  v: [number, number, number];
  /** Outward normal of the face. */
  n: [number, number, number];
}

export const CUBE_FACES: Record<FaceName, FaceConfig> = {
  f: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  r: { u: [0, 0, -1], v: [0, 1, 0], n: [1, 0, 0] },
  b: { u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, -1] },
  l: { u: [0, 0, 1], v: [0, 1, 0], n: [-1, 0, 0] },
  u: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
  d: { u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] },
};

export const LOAD_ORDER: FaceName[] = ["f", "r", "l", "b", "u", "d"];

/** Pyramid: level -> tiles per axis. Level 2 renders first (6 tiles), then
 *  level 1 (24), then level 0 (96) — each level is a full-quality upgrade. */
export const PYRAMID = {
  2: { cols: 1, rows: 1 },
  1: { cols: 2, rows: 2 },
  0: { cols: 4, rows: 4 },
} as const;

export const LEVELS_DESC: Array<keyof typeof PYRAMID> = [2, 1, 0];

export const TILE_PX = 512;

/** Wrap an assembled face canvas in a texture configured for sRGB cubemap
 *  sampling (LinearMipmapLinear + anisotropy — the near edge of the face is
 *  a long way away, mipmapping matters). */
export function faceTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Progressively assembles square faces from the 512px cube tiles. Faces are
 *  cached per (face, level); tiles are cached per (face, level, row, col).
 *  dispose() aborts in-flight fetches and frees bitmap memory. */
export class CubemapTileLoader {
  private tiles = new Map<string, ImageBitmap>();
  private faces = new Map<string, HTMLCanvasElement>();
  private controller = new AbortController();

  constructor(
    /** Provider mediaId for the scene's panorama. */
    private mediaId: string,
    /** Renderer API base (the backend tile relay, same-origin by default). */
    private base = `${API_BASE}/api/panorama/tile`,
  ) {}

  private tileUrl(face: FaceName, level: number, row: number, col: number): string {
    return `${this.base}/${this.mediaId}/${face}/${level}/${row}_${col}.jpg`;
  }

  private async fetchTile(face: FaceName, level: number, row: number, col: number): Promise<ImageBitmap> {
    const key = `${face}/${level}/${row}_${col}`;
    const hit = this.tiles.get(key);
    if (hit) return hit;

    const res = await fetch(this.tileUrl(face, level, row, col), {
      signal: this.controller.signal,
      // The relay marks tiles immutable; grabs are cheap.
      cache: "force-cache",
    });
    if (!res.ok) throw new Error(`tile ${key} -> HTTP ${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    this.tiles.set(key, bitmap);
    return bitmap;
  }

  /** Assemble one face at a level into a square canvas (tile grid in order). */
  async loadFace(face: FaceName, level: keyof typeof PYRAMID): Promise<HTMLCanvasElement> {
    const cacheKey = `${face}/${level}`;
    const hit = this.faces.get(cacheKey);
    if (hit) return hit;

    const { cols, rows } = PYRAMID[level];
    const px = cols * TILE_PX;
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");

    const tiles: Promise<void>[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push(
          this.fetchTile(face, level, r, c).then((bmp) => {
            ctx.drawImage(bmp, c * TILE_PX, r * TILE_PX, TILE_PX, TILE_PX);
          }),
        );
      }
    }
    await Promise.all(tiles);
    this.faces.set(cacheKey, canvas);
    return canvas;
  }

  /** Load every face of a level in priority order (ring first, then up/down). */
  async loadAllFaces(level: keyof typeof PYRAMID, order: readonly FaceName[] = LOAD_ORDER): Promise<Record<FaceName, HTMLCanvasElement>> {
    const out = {} as Record<FaceName, HTMLCanvasElement>;
    // Sequential so faces land in priority order and upgrade happens per face.
    for (const face of order) {
      out[face] = await this.loadFace(face, level);
    }
    return out;
  }

  dispose(): void {
    this.controller.abort();
    for (const bmp of this.tiles.values()) bmp.close();
    this.tiles.clear();
    this.faces.clear();
  }
}