#!/usr/bin/env python3
"""photo_to_scan.py — turn phone photos of paper documents into flat, upright scans.

Pipeline per page (all classical, no model downloads required):
  1. perspective   -- cv2 four-corner warp, only when the whole sheet is visible
  2. orientation   -- 90/270 axis from OCR text-line aspect (or ink profile),
                      then 0/180 from OCR quality with the line classifier off
                      (or from the ink centroid inside each text line)
  3. deskew        -- projection-profile search, the classical deskew criterion
  4. lighting      -- divide by a blurred background estimate (flat-field), then
                      renormalise the paper to pure white
  5. geometry      -- convex page silhouette, dark border trim, ink bbox, margin
  6. scan look     -- Sauvola(1997) ink mask composited over a whitened colour
                      layer, so text is crisp and red seals keep their hue

Required: numpy, scipy, Pillow.  Optional: OpenCV (quad warp, convex mask),
rapidocr-onnxruntime or tesseract (90 vs 270 offline), PyMuPDF (multi-page PDF).

Usage
  python photo_to_scan.py -i photo.jpg -o out/
  python photo_to_scan.py -i shots/ -o out/ --mode bw --pdf out/book.pdf
  python photo_to_scan.py -i photo.jpg -o out/ --orient 270 --deskew 2.5
  python photo_to_scan.py -i shots/ -o out/ --preview

Exit code stays 0 when orientation is uncertain; check the JSON "confidence"
field (or the preview sheet) and re-run with --orient N.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage as ndi

ANALYSIS_SIDE = 1100
"""Longest side used for all estimation (orientation / skew / borders)."""

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}


# ---------------------------------------------------------------------------
# image plumbing
# ---------------------------------------------------------------------------
def load_image(path: Path) -> Image.Image:
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    return im


def as_float(im: Image.Image) -> np.ndarray:
    return np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0


def resize_long(im: Image.Image, side: int) -> Image.Image:
    w, h = im.size
    scale = side / float(max(w, h))
    if scale >= 1.0:
        return im
    return im.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)


def to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8), "RGB")


def rotate_img(img: np.ndarray, deg: float, fill: float = 1.0) -> np.ndarray:
    """Rotate about the centre, expanding the canvas; `fill` colours the corners."""
    if abs(deg) < 1e-6:
        return img
    h, w = img.shape[:2]
    rad = math.radians(deg)
    c, s = math.cos(rad), math.sin(rad)
    nw = int(math.ceil(abs(w * c) + abs(h * s)))
    nh = int(math.ceil(abs(h * c) + abs(w * s)))
    # scipy maps output coordinates back to input: p_in = R(-deg) @ (p_out - c_out) + c_in
    mat2 = np.array([[c, s], [-s, c]], dtype=np.float64)
    c_in = np.array([(w - 1) / 2.0, (h - 1) / 2.0])
    c_out = np.array([(nw - 1) / 2.0, (nh - 1) / 2.0])
    off2 = c_in - mat2 @ c_out
    matrix = np.eye(img.ndim)
    matrix[:2, :2] = mat2
    offset = np.zeros(img.ndim)
    offset[:2] = off2
    out_shape = (nh, nw) if img.ndim == 2 else (nh, nw, img.shape[2])
    return ndi.affine_transform(
        img, matrix, offset=offset, output_shape=out_shape,
        order=1, mode="constant", cval=fill, prefilter=False,
    )


def rotate_quarter(img: np.ndarray, quarter: int) -> np.ndarray:
    """Rotate by quarter*90 degrees counter-clockwise (np.rot90 convention)."""
    return np.rot90(img, quarter % 4, axes=(0, 1))


# ---------------------------------------------------------------------------
# flat-field lighting
# ---------------------------------------------------------------------------
def background_luma(rgb: np.ndarray, frac: float = 0.06) -> np.ndarray:
    luma = rgb.mean(axis=2)
    sigma = max(8.0, frac * min(luma.shape))
    return ndi.gaussian_filter(luma, sigma, truncate=2.0)


def flatten(rgb: np.ndarray) -> np.ndarray:
    """Divide out the illumination, then normalise the paper to 1.0."""
    bg = np.maximum(background_luma(rgb), 1e-3)
    flat = rgb / bg[..., None]
    luma = flat.mean(axis=2)
    paper = flat[luma > np.percentile(luma, 75)]
    if paper.size > 100:
        scale = np.percentile(paper, 97, axis=0)
        scale = np.where(scale < 1e-3, 1.0, scale)
        flat = flat / scale
    return np.clip(flat, 0.0, 3.0)


def ink_mask(flat: np.ndarray, thresh: float = 0.72) -> np.ndarray:
    return flat.mean(axis=2) < thresh


# ---------------------------------------------------------------------------
# skew
# ---------------------------------------------------------------------------
def profile_score(mask: np.ndarray) -> float:
    """Peakiness of the horizontal ink profile (1.0 = uniform, big = text lines)."""
    rows = mask.sum(axis=1).astype(np.float64)
    total = rows.sum()
    if total <= 0:
        return 0.0
    return float((rows * rows).sum() / (total * total) * len(rows))


def _bands(profile: np.ndarray, rel: float = 0.25, min_len: int = 5, max_len: int = 220):
    if profile.size == 0 or profile.max() <= 0:
        return []
    on = profile > max(3.0, profile.max() * rel)
    out, start = [], None
    for i, v in enumerate(on):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(on)))
    return [(a, b) for a, b in out if min_len <= b - a <= max_len]


def baseline_bias(mask: np.ndarray) -> float:
    """Median ink centroid of the text lines, relative to the line-box centre.

    Upright CJK/Latin glyphs sit slightly high in their line box (ascenders up,
    no descenders), so the correct orientation gives a negative bias.
    """
    biases = []
    for a, b in _bands(mask.sum(axis=1).astype(np.float64)):
        sub = mask[a:b]
        if sub.sum() < 80:
            continue
        ys = np.repeat(np.arange(b - a, dtype=np.float64), sub.sum(axis=1))
        biases.append((ys.mean() - (b - a - 1) / 2.0) / float(b - a))
    return float(np.median(biases)) if biases else 0.0


def estimate_skew(mask: np.ndarray, limit: float = 12.0, coarse: float = 0.5,
                  fine: float = 0.1) -> float:
    """Rotation (degrees CCW) that makes the text rows sharpest."""
    work = mask.astype(np.float32)
    best_angle, best_score = 0.0, -1.0
    for angle in np.arange(-limit, limit + 1e-9, coarse):
        score = profile_score(rotate_img(work, float(angle), fill=0.0) > 0.5)
        if score > best_score:
            best_angle, best_score = float(angle), score
    for angle in np.arange(best_angle - coarse, best_angle + coarse + 1e-9, fine):
        score = profile_score(rotate_img(work, float(angle), fill=0.0) > 0.5)
        if score > best_score:
            best_angle, best_score = float(angle), score
    return best_angle


# ---------------------------------------------------------------------------
# optional OCR (orientation only)
# ---------------------------------------------------------------------------
def ocr_engine(kind: str = "auto"):
    if kind in ("auto", "rapidocr"):
        try:
            from rapidocr_onnxruntime import RapidOCR

            return ("rapidocr", RapidOCR())
        except Exception:
            pass
    if kind in ("auto", "tesseract"):
        try:
            import pytesseract

            pytesseract.get_tesseract_version()
            return ("tesseract", pytesseract)
        except Exception:
            pass
    return (None, None)


def ocr_boxes(engine, im: Image.Image, use_cls: bool = True):
    """[(x0, y0, x1, y1, text, score)] for the given image, or [] on failure."""
    kind, eng = engine
    if kind is None:
        return []
    try:
        if kind == "rapidocr":
            arr = np.asarray(im.convert("RGB"))[:, :, ::-1]
            try:
                res, _ = eng(arr, use_cls=use_cls)
            except TypeError:
                res, _ = eng(arr)
            out = []
            for poly, txt, score in res or []:
                xs = [p[0] for p in poly]
                ys = [p[1] for p in poly]
                out.append((min(xs), min(ys), max(xs), max(ys), txt, float(score)))
            return out
        import pytesseract

        data = pytesseract.image_to_data(im, lang="chi_sim+eng", output_type=pytesseract.Output.DICT)
        out = []
        for i, txt in enumerate(data["text"]):
            if not txt.strip() or int(data["conf"][i]) <= 0:
                continue
            out.append((data["left"][i], data["top"][i],
                        data["left"][i] + data["width"][i], data["top"][i] + data["height"][i],
                        txt, int(data["conf"][i]) / 100.0))
        return out
    except Exception:
        return []


def boxes_aspect(boxes):
    """Width/height ratio of the long text lines (None = no opinion).

    OCR rectifies each line before recognising it, so recognition confidence is
    the same at every rotation; the *shape* of the detected lines is what tells
    the page axis: ~0.2 = page on its side, ~5 = text already horizontal.
    """
    if len(boxes) < 4:
        return None
    pairs = []
    for b in boxes:
        w, h = max(1.0, b[2] - b[0]), max(1.0, b[3] - b[1])
        if max(w, h) > 3.0 * min(w, h):
            pairs.append((w, h))
    if len(pairs) < 3:
        return None
    return float(sum(w for w, _ in pairs) / sum(h for _, h in pairs))


def boxes_quality(boxes) -> float:
    """Characters recognised with high confidence — collapses on upside-down text."""
    total = 0.0
    for b in boxes:
        txt, score = b[4].strip(), b[5]
        if score >= 0.80 and txt:
            total += len(txt)
    return total


# ---------------------------------------------------------------------------
# page geometry
# ---------------------------------------------------------------------------
def trim_dark_border(rgb: np.ndarray, thresh: float = 0.45, max_frac: float = 0.18):
    """Strip the dark band (table, shadow) that touches the photo edge."""
    h, w = rgb.shape[:2]
    luma = rgb.mean(axis=2)
    top, bottom, left, right = 0, h, 0, w
    max_rows, max_cols = int(h * max_frac), int(w * max_frac)
    while bottom - top > h * 0.4 and top < max_rows and np.median(luma[top, left:right]) < thresh:
        top += 1
    while bottom - top > h * 0.4 and (h - bottom) < max_rows and np.median(luma[bottom - 1, left:right]) < thresh:
        bottom -= 1
    while right - left > w * 0.4 and left < max_cols and np.median(luma[top:bottom, left]) < thresh:
        left += 1
    while right - left > w * 0.4 and (w - right) < max_cols and np.median(luma[top:bottom, right - 1]) < thresh:
        right -= 1
    return top, bottom, left, right


def page_box(flat: np.ndarray, thresh: float = 0.55, pad_frac: float = 0.006):
    """Bounding box of the sheet (coarse blur swallows the text inside it)."""
    luma = flat.mean(axis=2)
    size = max(21, int(min(luma.shape) / 20) | 1)
    mask = ndi.uniform_filter(luma, size) > thresh
    h, w = mask.shape
    lab, n = ndi.label(mask)
    if n == 0:
        return 0, h, 0, w
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    k = int(sizes.argmax())
    if sizes[k] < 0.15 * mask.size:
        return 0, h, 0, w
    rows = np.where((lab == k).sum(axis=1) > 0.05 * w)[0]
    cols = np.where((lab == k).sum(axis=0) > 0.05 * h)[0]
    if rows.size == 0 or cols.size == 0:
        return 0, h, 0, w
    pad_y, pad_x = int(h * pad_frac), int(w * pad_frac)
    return (max(0, int(rows[0]) - pad_y), min(h, int(rows[-1]) + 1 + pad_y),
            max(0, int(cols[0]) - pad_x), min(w, int(cols[-1]) + 1 + pad_x))


def content_box(flat: np.ndarray, thresh: float = 0.78, pad_frac: float = 0.012):
    """Bounding box of the ink, ignoring single stray specks."""
    ink = flat.mean(axis=2) < thresh
    h, w = ink.shape
    if not ink.any():
        return 0, h, 0, w
    lab, n = ndi.label(ink)
    if n > 1:
        sizes = np.bincount(lab.ravel())
        keep = sizes >= max(40, 0.00002 * ink.size)
        keep[0] = False
        ink = keep[lab]
    rows = np.where(ink.sum(axis=1) > max(2, 0.002 * w))[0]
    cols = np.where(ink.sum(axis=0) > max(2, 0.002 * h))[0]
    if rows.size == 0 or cols.size == 0:
        return 0, h, 0, w
    pad_y, pad_x = int(round(h * pad_frac)), int(round(w * pad_frac))
    return (max(0, int(rows[0]) - pad_y), min(h, int(rows[-1]) + 1 + pad_y),
            max(0, int(cols[0]) - pad_x), min(w, int(cols[-1]) + 1 + pad_x))


def detect_quad(rgb: np.ndarray):
    """Four page corners (TL, TR, BR, BL) when the whole sheet is inside the frame."""
    try:
        import cv2
    except Exception:
        return None
    h, w = rgb.shape[:2]
    gray = cv2.GaussianBlur((rgb.mean(axis=2) * 255).astype(np.uint8), (5, 5), 0)
    edges = cv2.dilate(cv2.Canny(gray, 40, 120), np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for cnt in sorted(contours, key=cv2.contourArea, reverse=True)[:12]:
        if cv2.contourArea(cnt) < 0.30 * h * w:
            continue
        approx = cv2.approxPolyDP(cnt, 0.02 * cv2.arcLength(cnt, True), True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        pts = approx.reshape(4, 2).astype(np.float32)
        # a corner touching the frame means the sheet is clipped: a warp would be a guess
        if np.any(pts[:, 0] <= 1) or np.any(pts[:, 1] <= 1):
            continue
        if np.any(pts[:, 0] >= w - 2) or np.any(pts[:, 1] >= h - 2):
            continue
        s, d = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
        return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
                        dtype=np.float32)
    return None


def warp_quad(rgb: np.ndarray, pts: np.ndarray):
    try:
        import cv2
    except Exception:
        return rgb
    width = int(max(np.linalg.norm(pts[0] - pts[1]), np.linalg.norm(pts[2] - pts[3])))
    height = int(max(np.linalg.norm(pts[0] - pts[3]), np.linalg.norm(pts[1] - pts[2])))
    if width < 200 or height < 200:
        return rgb
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(pts.astype(np.float32), dst)
    return cv2.warpPerspective(rgb, m, (width, height), flags=cv2.INTER_CUBIC, borderValue=(1, 1, 1))


# ---------------------------------------------------------------------------
# the scan look: Sauvola ink layer over a whitened colour layer
# ---------------------------------------------------------------------------
def scan_curve(x: np.ndarray, black: float = 0.10, white: float = 0.80) -> np.ndarray:
    """Gentle level curve: paper -> 1.0, tint kept so seals stay readable."""
    y = np.clip((x - black) / max(1e-6, white - black), 0.0, 1.0)
    return y * y * (3.0 - 2.0 * y)


def sauvola_threshold(luma: np.ndarray, window: int = 41, k: float = 0.20,
                      dyn: float = 0.28) -> np.ndarray:
    """Sauvola & Pietikainen (1997):  T = m * (1 + k * (s / R - 1)).

    The standard adaptive binariser for scanned text (same formula as
    scikit-image's threshold_sauvola), implemented with box filters.
    """
    win = max(15, int(window) | 1)
    mean = ndi.uniform_filter(luma, win)
    sq = ndi.uniform_filter(luma * luma, win)
    std = np.sqrt(np.maximum(sq - mean * mean, 0.0))
    return np.clip(mean * (1.0 + k * (std / max(dyn, 1e-6) - 1.0)), 0.02, 0.98)


def ink_mask_sauvola(flat: np.ndarray, window_frac: float = 0.025, k: float = 0.20,
                     min_size: int = 10) -> np.ndarray:
    """Ink pixels per Sauvola, minus dust specks."""
    luma = flat.mean(axis=2)
    win = max(15, int(min(luma.shape) * window_frac) | 1)
    ink = luma < sauvola_threshold(luma, win, k)
    if not ink.any():
        return ink
    lab, n = ndi.label(ink)
    if n <= 1:
        return ink
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    keep = sizes >= max(3, min_size)
    keep[0] = False
    return keep[lab]


def render(flat: np.ndarray, mode: str = "color", window_frac: float = 0.025,
           ink_k: float = 0.20) -> np.ndarray:
    """Flat-lit linear image -> scan-looking page.

    Two layers, the way phone scanners do it: a whitened colour layer that keeps
    seals and rulings, and a Sauvola ink mask composited on top so the text stays
    crisp even where the paper is dirty or the light was uneven.
    """
    ink = ink_mask_sauvola(flat, window_frac, ink_k)
    if mode == "bw":
        out = 1.0 - ink.astype(np.float32)
        return np.repeat(out[..., None], 3, axis=2)

    base = scan_curve(flat)
    # saturated ink (red seal, blue pen) keeps its hue instead of being crushed
    hi = flat.max(axis=2)
    lo = flat.min(axis=2)
    sat = (hi - lo) / np.maximum(hi, 1e-6)
    strong = ink & (sat < 0.30)
    out = base * (1.0 - 0.88 * strong[..., None])
    if mode == "gray":
        g = out.mean(axis=2)
        return np.repeat(g[..., None], 3, axis=2)
    return np.clip(out, 0.0, 1.0)


def despeckle(img: np.ndarray, thresh: float = 0.42, max_size: int = 12,
              max_dim: int = 4) -> np.ndarray:
    """Remove single-pixel dust, and nothing else.

    Deliberately conservative: only near-black specks a few pixels across go.
    Thin pencil strokes and 1px table rules must survive, so a component has to
    be both tiny and compact to qualify.
    """
    ink = img.mean(axis=2) < thresh
    if not ink.any():
        return img
    lab, n = ndi.label(ink)
    if n == 0:
        return img
    sizes = np.bincount(lab.ravel())
    boxes = ndi.find_objects(lab)
    kill = np.zeros(n + 1, bool)
    for i in range(1, n + 1):
        sl = boxes[i - 1]
        if sl is None:
            continue
        if sizes[i] <= max_size and max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) <= max_dim:
            kill[i] = True
    if not kill.any():
        return img
    out = img.copy()
    out[kill[lab]] = 1.0
    return out


# ---------------------------------------------------------------------------
# orientation
# ---------------------------------------------------------------------------
def pick_orientation(small_rgb: np.ndarray, ocred: str = "auto", verbose: bool = False):
    """Return (quarter_turns_ccw, confidence, detail).

    Two independent questions:
      * axis (0/180 vs 90/270): OCR text-line aspect when available, otherwise
        the peakiness of the horizontal ink profile
      * which way up (0 vs 180): OCR quality with the 180-degree line classifier
        switched off, otherwise the median ink centroid inside each text line
    """
    flat = flatten(small_rgb)
    mask = ink_mask(flat)
    engine = ocr_engine(ocred)
    detail = {"source": "profile", "profile": {}, "bias": {}, "ocr_quality": {}}

    scores = {q: profile_score(rotate_quarter(mask, q)) for q in range(4)}
    detail["profile"] = {f"{q * 90}": round(v, 2) for q, v in scores.items()}

    boxes0, ratio = [], None
    if engine[0] is not None:
        boxes0 = ocr_boxes(engine, to_image(small_rgb), use_cls=False)
        ratio = boxes_aspect(boxes0)
        detail.update(ocr=engine[0], ocr_box_wh=None if ratio is None else round(ratio, 2),
                      ocr_boxes=len(boxes0))

    if ratio is not None and ratio > 1.6:
        axis, detail["source"] = 0, engine[0]
    elif ratio is not None and ratio < 0.6:
        axis, detail["source"] = 90, engine[0]
    else:
        axis = 0 if (scores[0] + scores[2]) >= (scores[1] + scores[3]) else 90
        detail["source"] = "profile" if engine[0] is None else engine[0] + "+profile"

    cand, flip = axis // 90, (axis // 90 + 2) % 4
    q_up = q_dn = None
    if engine[0] is not None:
        im = to_image(small_rgb)
        q_up = boxes_quality(boxes0) if cand == 0 else boxes_quality(
            ocr_boxes(engine, im.rotate(cand * 90, expand=True), use_cls=False))
        q_dn = boxes_quality(ocr_boxes(engine, im.rotate(flip * 90, expand=True), use_cls=False))
        detail["ocr_quality"] = {f"{cand * 90}": int(q_up), f"{flip * 90}": int(q_dn)}

    b_up = baseline_bias(rotate_quarter(mask, cand))
    b_dn = baseline_bias(rotate_quarter(mask, flip))
    detail["bias"] = {f"{cand * 90}": round(b_up, 5), f"{flip * 90}": round(b_dn, 5)}

    if q_up is not None and max(q_up, q_dn) >= 30 and q_up != q_dn:
        quarter = cand if q_up > q_dn else flip
        hi, lo = max(q_up, q_dn), max(1.0, min(q_up, q_dn))
        confidence = "high" if hi >= 2.0 * lo else ("medium" if hi >= 1.35 * lo else "low")
    else:
        quarter = cand if b_up <= b_dn else flip
        delta = abs(b_up - b_dn)
        confidence = "high" if delta > 0.006 else ("medium" if delta > 0.0015 else "low")

    if verbose:
        print(f"    profile      {detail['profile']}", file=sys.stderr)
        print(f"    ocr          axis={axis} box_wh={detail.get('ocr_box_wh')} "
              f"quality={detail['ocr_quality']}", file=sys.stderr)
        print(f"    bias         {detail['bias']}", file=sys.stderr)
    return quarter, confidence, detail


# ---------------------------------------------------------------------------
# sheet silhouette / margin
# ---------------------------------------------------------------------------
def paper_mask(img: np.ndarray, thresh: float = 0.55) -> np.ndarray:
    """The sheet as a filled silhouette.

    Brightness alone is not enough: a dense handwritten block is as dark as the
    table the sheet lies on, and whitening it would erase the ink. So the sheet
    is separated at a coarse scale and then closed into a convex silhouette, and
    everything inside it is kept however dark it is.
    """
    luma = img.mean(axis=2)
    size = max(21, int(min(luma.shape) / 20) | 1)
    bright = ndi.binary_closing(ndi.uniform_filter(luma, size) > thresh,
                                np.ones((5, 5), bool), iterations=2)
    lab, n = ndi.label(bright)
    if n == 0:
        return np.ones(luma.shape, bool)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    k = int(sizes.argmax())
    if sizes[k] < 0.15 * bright.size:
        return np.ones(luma.shape, bool)
    blob = lab == k
    try:
        import cv2

        contours, _ = cv2.findContours(blob.astype(np.uint8), cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            hull = cv2.convexHull(max(contours, key=cv2.contourArea))
            mask = np.zeros(blob.shape, np.uint8)
            cv2.fillPoly(mask, [hull], 1)
            # a few pixels inside the silhouette: the page-edge shadow stays out
            mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
            if mask.mean() > 0.15:
                return mask.astype(bool)
    except Exception:
        pass
    return ndi.binary_fill_holes(blob)


def add_margin(img: np.ndarray, frac: float = 0.015) -> np.ndarray:
    h, w = img.shape[:2]
    my, mx = int(round(h * frac)), int(round(w * frac))
    if my <= 0 and mx <= 0:
        return img
    out = np.ones((h + 2 * my, w + 2 * mx, img.shape[2]), np.float32)
    out[my:my + h, mx:mx + w] = img
    return out


# ---------------------------------------------------------------------------
# per-page pipeline
# ---------------------------------------------------------------------------
def process_one(path: Path, outdir: Path, args):
    im = load_image(path)
    report = {"input": str(path), "source_size": list(im.size)}

    w, h = im.size
    if args.max_side and max(w, h) > args.max_side:
        scale = args.max_side / float(max(w, h))
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    rgb_full = as_float(im)
    rgb_small = as_float(resize_long(im, ANALYSIS_SIDE))

    # 1. perspective, only when every page corner is inside the frame
    report["perspective"] = "none"
    if args.perspective:
        pts = detect_quad(rgb_small)
        if pts is not None:
            report["perspective"] = "quad"
            fx = rgb_full.shape[1] / float(rgb_small.shape[1])
            fy = rgb_full.shape[0] / float(rgb_small.shape[0])
            rgb_small = warp_quad(rgb_small, pts)
            rgb_full = warp_quad(rgb_full, pts * np.array([fx, fy], dtype=np.float32))

    # 2. coarse rotation
    if args.orient == "auto":
        quarter, confidence, detail = pick_orientation(rgb_small, args.ocr, args.verbose)
        report.update(orientation=quarter * 90, confidence=confidence, orientation_detail=detail)
    else:
        quarter, confidence = (int(args.orient) // 90) % 4, "forced"
        report.update(orientation=int(args.orient), confidence=confidence)

    rgb_small = rotate_quarter(rgb_small, quarter)
    rgb_full = rotate_quarter(rgb_full, quarter)

    # 3. dark photo border, then skew from the flattened analysis copy
    t, b, l, r = trim_dark_border(rgb_small)
    fx = rgb_full.shape[1] / float(rgb_small.shape[1])
    fy = rgb_full.shape[0] / float(rgb_small.shape[0])
    rgb_work = rgb_full[int(t * fy):int(b * fy), int(l * fx):int(r * fx)]
    flat_work = flatten(rgb_work)
    if args.deskew == "auto":
        skew = estimate_skew(ink_mask(flatten(rgb_small[int(t):int(b), int(l):int(r)])),
                             limit=args.max_skew)
    else:
        skew = float(args.deskew)
    report["skew_deg"] = round(skew, 3)

    # 4. crop to the ink, scan-render, whiten the sheet, rotate out the skew
    y0, y1, x0, x1 = content_box(flat_work)
    report["crop_px"] = [int(x1 - x0), int(y1 - y0)]
    scanned = render(flat_work[y0:y1, x0:x1], args.mode, args.window, args.ink_k)
    if args.mode != "gray":
        scanned = despeckle(scanned)
    if args.mask_outside:
        pm = paper_mask(scanned, thresh=args.paper)
        scanned = np.where(pm[..., None], scanned, 1.0).astype(np.float32)
    if abs(skew) > 1e-3:
        scanned = rotate_img(scanned, -skew, fill=1.0)

    # 5. final geometry: sheet box, ink box, white margin
    py0, py1, px0, px1 = page_box(scanned, thresh=args.paper)
    scanned = scanned[py0:py1, px0:px1]
    cy0, cy1, cx0, cx1 = content_box(scanned, thresh=0.86, pad_frac=0.008)
    out_img = to_image(add_margin(scanned[cy0:cy1, cx0:cx1], frac=args.margin))

    # 6. write
    outdir.mkdir(parents=True, exist_ok=True)
    jpg = outdir / f"{path.stem}.scan.jpg"
    out_img.save(jpg, quality=92, dpi=(args.dpi, args.dpi), subsampling=1)
    report["output"] = str(jpg)
    report["output_size"] = list(out_img.size)
    if args.png:
        png = outdir / f"{path.stem}.scan.png"
        out_img.save(png, dpi=(args.dpi, args.dpi))
        report["output_png"] = str(png)
    return report, out_img


# ---------------------------------------------------------------------------
# PDF / preview
# ---------------------------------------------------------------------------
def _png_bytes(im: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    im.save(buf, format="PNG", dpi=(300, 300))
    return buf.getvalue()


def build_pdf(pages, dest: Path, dpi: int):
    """One image per page; the page box is the image at `dpi`, so A4@300 stays A4."""
    try:
        import fitz  # PyMuPDF
    except Exception:
        fitz = None
    if fitz is not None:
        doc = fitz.open()
        for im in pages:
            w_pt = im.size[0] * 72.0 / dpi
            h_pt = im.size[1] * 72.0 / dpi
            page = doc.new_page(width=w_pt, height=h_pt)
            page.insert_image(fitz.Rect(0, 0, w_pt, h_pt), stream=_png_bytes(im))
        doc.save(str(dest), deflate=True, garbage=3)
        doc.close()
        return dest
    pages[0].save(dest, "PDF", resolution=dpi, save_all=True, append_images=pages[1:])
    return dest


def preview_sheet(path: Path, out: Path, ocred: str = "auto"):
    """2x2 contact sheet of the four candidate rotations (cheapest sanity check)."""
    rgb = as_float(resize_long(load_image(path), 700))
    quarter, confidence, detail = pick_orientation(rgb, ocred)
    tiles = []
    for q in range(4):
        cand = to_image(render(flatten(rotate_quarter(rgb, q)), "gray"))
        cand.thumbnail((420, 420), Image.LANCZOS)
        tiles.append(cand)
    tw = max(t.size[0] for t in tiles)
    th = max(t.size[1] for t in tiles)
    sheet = Image.new("RGB", (tw * 2 + 24, th * 2 + 24), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 2) * (tw + 16) + 8, (i // 2) * (th + 16) + 8))
    sheet.save(out)
    return {"path": str(out), "picked": quarter * 90, "confidence": confidence, "detail": detail}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def collect_inputs(target: Path):
    if target.is_file():
        return [target]
    return [p for p in sorted(target.rglob("*"))
            if p.is_file() and p.suffix.lower() in IMAGE_EXTS]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Phone photo -> flat scan (auto rotate + deskew + clean).")
    ap.add_argument("-i", "--input", required=True, help="image file or directory")
    ap.add_argument("-o", "--outdir", default="scan_out", help="output directory")
    ap.add_argument("--mode", choices=["color", "gray", "bw"], default="color",
                    help="color keeps red seals (default) | gray | bw hard binarise")
    ap.add_argument("--orient", default="auto",
                    help="auto | 0 | 90 | 180 | 270 (use when auto reports low confidence)")
    ap.add_argument("--deskew", default="auto", help="auto | 0 | <degrees CCW>")
    ap.add_argument("--max-skew", type=float, default=12.0, help="skew search range (default 12)")
    ap.add_argument("--dpi", type=int, default=300, help="DPI written into JPG/PDF")
    ap.add_argument("--max-side", type=int, default=2600, help="downscale the long side to this (0 = keep)")
    ap.add_argument("--window", type=float, default=0.025,
                    help="Sauvola window as a fraction of the short side")
    ap.add_argument("--ink-k", type=float, default=0.20,
                    help="Sauvola k: higher keeps fainter pen strokes (default 0.20)")
    ap.add_argument("--paper", type=float, default=0.55,
                    help="brightness above which a pixel counts as paper (default 0.55)")
    ap.add_argument("--margin", type=float, default=0.015, help="white margin fraction")
    ap.add_argument("--mask-outside", dest="mask_outside", action="store_true", default=True,
                    help="whiten everything that is not the sheet (default on)")
    ap.add_argument("--no-mask", dest="mask_outside", action="store_false",
                    help="keep pixels outside the sheet")
    ap.add_argument("--perspective", dest="perspective", action="store_true", default=True)
    ap.add_argument("--no-perspective", dest="perspective", action="store_false")
    ap.add_argument("--png", action="store_true", help="also write a lossless PNG")
    ap.add_argument("--pdf", default=None, help="combine every page into this PDF")
    ap.add_argument("--preview", action="store_true", help="write <name>.preview.png (2x2 sheet)")
    ap.add_argument("--ocr", default="auto", choices=["auto", "rapidocr", "tesseract", "off"],
                    help="engine used to decide the axis / 180 flip (default auto)")
    ap.add_argument("--json", default=None, help="write the full JSON report here")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    if args.ocr == "off":
        args.ocr = "none"

    target = Path(args.input).expanduser()
    if not target.exists():
        ap.error(f"input not found: {target}")
    files = collect_inputs(target)
    if not files:
        ap.error(f"no images under {target}")

    outdir = Path(args.outdir).expanduser()
    reports, pages = [], []
    for idx, f in enumerate(files, 1):
        if args.verbose:
            print(f"[{idx}/{len(files)}] {f.name}", file=sys.stderr)
        report, img = process_one(f, outdir, args)
        reports.append(report)
        pages.append(img)
        if args.preview:
            prev = preview_sheet(f, outdir / f"{f.stem}.preview.png", args.ocr)
            report["preview"] = prev["path"]
            report["preview_pick"] = prev["picked"]
        if args.verbose:
            print(f"{f.name}: orient={report.get('orientation')} conf={report.get('confidence')} "
                  f"skew={report.get('skew_deg')} -> {report['output']}", file=sys.stderr)

    payload = {"tool": "photo-to-scan", "version": 1, "pages": reports}
    if args.pdf:
        payload["pdf"] = str(build_pdf(pages, Path(args.pdf).expanduser(), args.dpi))
    if args.json:
        Path(args.json).expanduser().write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                                               encoding="utf-8")
    summary = {"pages": [{k: r.get(k) for k in
                          ("input", "orientation", "confidence", "skew_deg", "output")}
                         for r in reports]}
    if "pdf" in payload:
        summary["pdf"] = payload["pdf"]
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
