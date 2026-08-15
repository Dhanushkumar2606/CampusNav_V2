"""Panorama tile relay — the single access point for the SRM 360° cube tiles.

Why this exists: the SRM virtual-tour server (webstor.srmist.edu.in) sends no
CORS headers, so a browser cannot read its images — fetch() is blocked, and
textures for WebGL fail the same origin check. This endpoint proxies the
*public* tiles through the backend (same origin from the SPA's point of view),
so the WebGL cubemap renderer can load them trivially.

Security model:
- Only the panorama mediaIds embedded in the campus seed config are reachable
  (an allowlist — no arbitrary URL fetching).
- face/level/row/col are validated against the tile pyramid geometry before
  the upstream URL is built; every path segment is a strict enum or bound.
- Responses are end-to-end JPEG bytes; nothing is cached server-side.
"""

from __future__ import annotations

import asyncio
import urllib.error
import urllib.request

from fastapi import APIRouter, HTTPException, Response

router = APIRouter(prefix="/panorama", tags=["panorama"])

# The provider's tile layout for each mapped scene:
#   panorama_<MEDIA_ID>_0/<face>/<level>/<row>_<col>.jpg
# level 2 = 1x1 tile (512px), level 1 = 2x2 (1024px), level 0 = 4x4 (2048px).
_UPSTREAM = (
    "https://webstor.srmist.edu.in/web_assets/srmist-virtual-tour-vo/media/"
    "panorama_{id}_0/{face}/{level}/{row}_{col}.jpg"
)

# The panorama mediaIds that appear in the campus seed config
# (backend/seed_data/srm_ktr.json). Keep in sync when new scenes are mapped.
_ALLOWED_MEDIA_IDS: frozenset[str] = frozenset(
    {
        "94652D98_145D_D693_419A_9AE6E084796B",  # central library
        "1FF1BDF7_B611_4E76_41E0_09F5FAE2913E",  # tech park
        "1FF19650_B610_DD8A_41C8_F03127ADA2BB",  # auditorium
        "376DF872_2734_77E8_41BE_53A2EB32FDD1",  # main gate
        "78E1DFC8_2754_4938_41AE_01C343A2EAB6",  # univ building
        "36C2700C_2387_11BE_4188_8FE1A1518355",  # boys hostel
        "73C4F6A7_6046_5D8D_41B3_CEA0E6CA64A4",  # hitech block
    }
)

_FACES: frozenset[str] = frozenset({"r", "l", "u", "d", "f", "b"})

# level -> inclusive (min, max) tile index along each axis.
_LEVEL_BOUNDS: dict[int, tuple[int, int]] = {
    0: (0, 3),
    1: (0, 1),
    2: (0, 0),
}


def _fetch_tile(url: str) -> bytes:
    try:
        with urllib.request.urlopen(url, timeout=20) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Upstream tile unavailable") from exc
    except Exception as exc:  # network errors, timeouts, DNS …
        raise HTTPException(status_code=502, detail="Upstream tile unavailable") from exc


@router.get("/tile/{media_id}/{face}/{level}/{row}_{col}.jpg")
async def panorama_tile(media_id: str, face: str, level: int, row: int, col: int) -> Response:
    """Stream one 512px cube tile via the backend (same-origin for the SPA)."""
    if media_id not in _ALLOWED_MEDIA_IDS:
        raise HTTPException(status_code=404, detail="Unknown panorama")
    if face not in _FACES:
        raise HTTPException(status_code=400, detail="Invalid face")
    bounds = _LEVEL_BOUNDS.get(level)
    if bounds is None:
        raise HTTPException(status_code=400, detail="Invalid level")
    lo, hi = bounds
    if not (lo <= row <= hi and lo <= col <= hi):
        raise HTTPException(status_code=400, detail="Tile outside pyramid bounds")

    url = _UPSTREAM.format(id=media_id, face=face, level=level, row=row, col=col)
    content = await asyncio.to_thread(_fetch_tile, url)
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )