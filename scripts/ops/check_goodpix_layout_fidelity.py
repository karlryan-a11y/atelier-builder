#!/usr/bin/env python3
"""Does a converted GoodPix look LOOK like the original? By hand, not in the build (needs images).

Redraws each conversion the way Atelier's canvas draws it (Konva semantics: translate(x,y) .
rotate . scale . translate(-offset); a closet piece is its image scaled to target_height, mirrored
about its own x when flipped; a picture is its box, mirrored inside it) and compares the result to
GoodPix's own baked picture of that look. Text is not drawn (fonts), so the comparison masks
nothing and a few points of error is the handwriting. Reports mean grey error per look (0-255).

  node scripts/dump-goodpix-conversions.mjs 40 /tmp/gp_conv.json
  python3 scripts/ops/check_goodpix_layout_fidelity.py /tmp/gp_conv.json [outdir]
"""
import hashlib, json, math, os, sys, urllib.parse, urllib.request
import numpy as np, cv2

CACHE = "/tmp/gp_img_cache"; os.makedirs(CACHE, exist_ok=True)
def fetch(u):
    k = CACHE + "/" + hashlib.md5(u.encode()).hexdigest()
    if not os.path.exists(k):
        b = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60).read()
        open(k, "wb").write(b)
    return open(k, "rb").read()
def load(u):
    im = cv2.imdecode(np.frombuffer(fetch(u), np.uint8), cv2.IMREAD_UNCHANGED)
    if im is None: return None
    if im.ndim == 2: im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    if im.shape[2] == 3: im = cv2.cvtColor(im, cv2.COLOR_BGR2BGRA)
    return im

def draw(canvas, img, x, y, rot, sx, sy, offx, offy, k):
    a = math.radians(rot); c, s = math.cos(a), math.sin(a)
    # p = (x,y) + R * ((u - offx)*sx, (v - offy)*sy), all board units, then *k to pixels
    M = np.array([[c*sx, -s*sy, 0], [s*sx, c*sy, 0]], np.float32) * k
    M[0, 2] = (x - (c*sx*offx - s*sy*offy)) * k
    M[1, 2] = (y - (s*sx*offx + c*sy*offy)) * k
    H, W = canvas.shape[:2]
    w = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0)).astype(np.float32)
    al = w[:, :, 3:4] / 255.0
    return canvas * (1 - al) + w[:, :, :3] * al

def render(conv, out=540):
    cw, ch = conv["canvas"]["canvas"]["width"], conv["canvas"]["canvas"]["height"]
    k = out / cw
    cvs = np.full((int(round(ch * k)), out, 3), 255, np.float32)
    for n in sorted(conv["canvas"]["nodes"], key=lambda n: n["z_index"]):
        try:
            if n["type"] == "closet_item":
                u = conv["urls"].get(n["id"])
                if not u: continue
                im = load(u)
                s = n["target_height"] / im.shape[0]
                cvs = draw(cvs, im, n["x"], n["y"], n["rotation"], -s if n["flipped"] else s, s, 0, 0, k)
            elif n["type"] == "picture":
                u = n["src"]
                im = load(u)
                sx = n["width"] / im.shape[1]; sy = n["height"] / im.shape[0]
                fx, fy = n.get("flipped"), n.get("flipped_y")
                cvs = draw(cvs, im, n["x"], n["y"], n["rotation"], -sx if fx else sx, -sy if fy else sy,
                           im.shape[1] if fx else 0, im.shape[0] if fy else 0, k)
        except Exception:
            continue
    return cvs.astype(np.uint8)

def main():
    convs = json.load(open(sys.argv[1])); outdir = sys.argv[2] if len(sys.argv) > 2 else None
    errs = []
    for c in convs:
        if not c.get("preview"): continue
        r = render(c)
        pv = load(c["preview"])
        if pv.shape[2] == 4:
            al = pv[:, :, 3:4] / 255.0; pv = (pv[:, :, :3] * al + 255 * (1 - al)).astype(np.uint8)
        else: pv = pv[:, :, :3]
        pv = cv2.resize(pv, (r.shape[1], r.shape[0]), interpolation=cv2.INTER_AREA)
        e = float(np.mean(np.abs(cv2.cvtColor(r, cv2.COLOR_BGR2GRAY).astype(np.float32) - cv2.cvtColor(pv, cv2.COLOR_BGR2GRAY).astype(np.float32))))
        errs.append((e, c))
        if outdir:
            os.makedirs(outdir, exist_ok=True)
            cv2.imwrite(f"{outdir}/{e:05.1f}_{c['id']}.jpg", np.hstack([pv, r]))
    errs.sort(key=lambda t: t[0])
    es = [e for e, _ in errs]
    print(f"{len(es)} looks | mean grey error: median {np.median(es):.1f}, p90 {np.percentile(es, 90):.1f}, worst {max(es):.1f}")
    print(f"  under 5: {sum(e < 5 for e in es)}   5-10: {sum(5 <= e < 10 for e in es)}   10+: {sum(e >= 10 for e in es)}")
    for e, c in errs[-5:]:
        print(f"  worst: {e:5.1f}  {c['name']}  placed {c['placed']}/{c['inPicture']} pictures {c['pictures']} skipped {c['skipped']}")

if __name__ == "__main__":
    main()
