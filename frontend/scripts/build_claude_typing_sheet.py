#!/usr/bin/env python
"""Regenerate public/analytics/claude-jtc-typing.png from the supplied poses.

    python frontend/scripts/build_claude_typing_sheet.py <dir-with-1..5.png>

Not part of the app build — a one-shot asset tool, kept in the repo because
the normalisation below is load-bearing: the five poses were drawn
independently and drift by a few pixels, so a naive "paste them side by side"
export makes the loop judder. See the "Analytics in-panel loader" section of
CLAUDE.md before changing anything here.

What it does, in order:
  1. strip the annotation badges burnt into poses 1, 2 and 4
  2. register each pose by INTEGER TRANSLATION onto two rigid world anchors:
     the laptop lid tip (x) and the top row of the ground line (y). No
     rescale is applied - interocular distance varies by <=1.5% across the
     poses, and rescaling would blur the pixel art. Registering on the world
     rather than on the mascot is deliberate: it keeps each pose's own
     hand-to-keyboard contact exactly as the artist drew it.
  3. crop to the union content bbox and centre each pose in a uniform cell
     with a transparent gutter, so sub-pixel rounding at the CSS window edge
     can only ever expose blank space, never a neighbouring pose
  4. lay ONE canonical ground-line band behind every cell - its thickness
     (4-6 rows) and end points differ per pose, which would otherwise
     shimmer as the frames step
  5. generate a second ROW of the same five poses with the eyes closed, so the
     blink can run on its own irregular timer instead of being locked to the
     typing cycle. The supplied poses all have identical fully-open eyes, so
     the closed lid is derived from each pose's own pixels: the eye rectangle
     is filled per column with the face pixel immediately BELOW it (verified
     to be face material, never cap or silhouette), then a thin bar of the
     eye's own colour is drawn as the shut lid. Nothing is invented and the
     fill can never misregister, because it is baked per pose.
  6. write the 5x2 sheet, and assert the invariants the CSS relies on

Requires Pillow.
"""
import os
import sys
from collections import Counter

from PIL import Image

BADGE = 64                      # annotation badge is inside this top-left square
CELL_W, CELL_H = 578, 306
PAD_X, PAD_Y = 8, 4             # transparent gutter inside each cell
REF_LAP, REF_G = 95, 354        # anchor target on the working canvas
CANVAS = (604, 420)
CROP = (22, 61, 584, 360)       # union content bbox once registered
GROUND_BAND = list(range(297, 303))
DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "public", "analytics", "claude-jtc-typing.png")


LID_H = 4               # rendered thickness of the shut lid, in sheet px
LID_DROP = 0.58         # lid sits slightly below the eye's centre - lids close down
EYE_PAD = 2             # swallow the eye's anti-aliased fringe, which sits just
                        # outside the flood-filled core and would otherwise stay
                        # behind as a faint 1px outline of the open eye

LIFTS = (0, 7, 13, 20)  # hand-lift levels in cell px (0 = resting on the keys)
CUT_Y = 229             # excision line: below the muzzle, inside the uniform arm
ARM_GAP = 6             # keep this clear of the torso so the feet are never lifted
SCALE = 2               # sheet is authored at full res then halved (exact 2:1)


def eye_rects(cell):
    """The two eyes of a pose: solid dark blobs ringed by face material.

    Ringed-by-face is what separates them from the cap's dark lettering.
    """
    w, h = cell.size
    p = cell.load()
    seen, found = set(), []
    for y in range(h):
        for x in range(w):
            if (x, y) in seen or kind(p[x, y]) != "black":
                continue
            stack, comp = [(x, y)], []
            seen.add((x, y))
            while stack:
                cx, cy = stack.pop()
                comp.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if (0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen
                            and kind(p[nx, ny]) == "black"):
                        seen.add((nx, ny))
                        stack.append((nx, ny))
            if len(comp) < 200:
                continue
            xs, ys = [q[0] for q in comp], [q[1] for q in comp]
            box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
            ring = [p[cx, cy]
                    for cx in range(box[0] - 3, box[2] + 3)
                    for cy in range(box[1] - 3, box[3] + 3)
                    if not (box[0] <= cx < box[2] and box[1] <= cy < box[3])
                    and 0 <= cx < w and 0 <= cy < h]
            if ring and sum(1 for q in ring if kind(q) == "body") / len(ring) > 0.5:
                found.append(box)
    return sorted(found)


def padded(box, pad=EYE_PAD):
    return (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)


def torso_left(cell):
    """Leftmost column occupied by the tall torso mass.

    Everything left of it in the keyboard band is arm; everything at or right
    of it is torso and feet, which must never be lifted.
    """
    w, h = cell.size
    p = cell.load()
    for x in range(w):
        runs, start = [], None
        for y in range(h):
            if kind(p[x, y]) == "body":
                start = y if start is None else start
            elif start is not None:
                runs.append(y - start)
                start = None
        if start is not None:
            runs.append(h - start)
        if runs and max(runs) > 100:
            return x
    raise SystemExit("could not locate the torso")


def lift_hands(cell, k, plate):
    """Raise the hands off the keys by k px, keeping everything else fixed.

    Excises a k-px slice from the middle of each arm column and slides the
    hand up into it. The tentacle is one flat colour, so removing a slice from
    its middle is invisible; what the hand vacates is filled from `plate`, an
    un-occluded laptop reconstructed from all five poses (each occludes a
    different part of it, so their union is complete where it matters).
    Nothing is invented: every pixel written is either the arm's own colour or
    a laptop pixel that genuinely exists in another pose.
    """
    if k == 0:
        return cell.copy()
    out = cell.copy()
    o, s, pl = out.load(), cell.load(), plate.load()
    x1 = torso_left(cell) - ARM_GAP
    bottom = GROUND_BAND[0] - 2
    for x in range(0, x1):
        if not any(kind(s[x, y]) == "body" for y in range(CUT_Y, bottom)):
            continue
        # Slide the column's whole below-cut content up as ONE unit. Copying
        # only the body pixels would leave the original arm showing through
        # wherever the shifted copy has a gap, which shreds any arm drawn as
        # more than one run in a column.
        for y in range(CUT_Y, bottom):
            src = y + k
            if src < bottom and kind(s[x, src]) == "body":
                o[x, y] = s[x, src]
            elif kind(s[x, y]) == "body":          # vacated -> laptop beneath
                o[x, y] = pl[x, y] if pl[x, y][3] else (0, 0, 0, 0)
            # anything else (laptop, impact marks, empty) is left untouched
    return out


def _face_tone(cell, box, halo=5, reach=13):
    """The dominant face colour in an annulus around `box`.

    Sampled from an annulus, not from the rows touching the eye: those carry a
    subtle highlight, and interpolating between them leaves a visibly lighter
    rectangle where the eye was. The face is pixel-noisy from the supply
    pipeline but perceptually flat (every pose's annulus modal agrees to within
    a few units), so one flat tone reads as face and hides the seam entirely.
    """
    w, h = cell.size
    p = cell.load()
    x0, y0, x1, y1 = box
    ring = [p[x, y]
            for x in range(x0 - reach, x1 + reach)
            for y in range(y0 - reach, y1 + reach)
            if 0 <= x < w and 0 <= y < h
            and not (x0 - halo <= x < x1 + halo and y0 - halo <= y < y1 + halo)
            and kind(p[x, y]) == "body"]
    if not ring:
        raise SystemExit(f"no face material around eye {box}")
    return Counter(ring).most_common(1)[0][0]


def close_eyes(cell):
    """Return a copy of `cell` with both eyes shut."""
    out = cell.copy()
    p = out.load()
    eyes = eye_rects(cell)
    if len(eyes) != 2:
        raise SystemExit(f"expected 2 eyes per pose, found {len(eyes)}")
    for core in eyes:
        box = padded(core)
        x0, y0, x1, y1 = box
        tone = _face_tone(cell, box)
        for x in range(x0, x1):
            for y in range(y0, y1):
                p[x, y] = tone
        lid_y = y0 + int(round((y1 - y0) * LID_DROP)) - LID_H // 2
        lid = cell.load()[(x0 + x1) // 2, (y0 + y1) // 2]   # the eye's own colour
        for y in range(lid_y, lid_y + LID_H):
            for x in range(x0, x1):
                p[x, y] = lid
    return out


def kind(p):
    """Coarse part classification used only to find the anchors."""
    r, g, b, a = p
    if a < 8:
        return None
    if r < 60 and g < 60 and b < 60:
        return "black"
    if r > 120 and r > g + 40 and r > b + 40:
        return "body"
    return "grey" if max(r, g, b) - min(r, g, b) < 40 else "other"


def load(src, i):
    im = Image.open(os.path.join(src, f"{i}.png")).convert("RGBA")
    px = im.load()
    for y in range(BADGE):
        for x in range(BADGE):
            px[x, y] = (0, 0, 0, 0)
    return im


def anchors(im):
    """(ground line rows, x of the laptop lid tip)."""
    w, h = im.size
    px = im.load()
    rows = [y for y in range(h)
            if sum(1 for x in range(w) if px[x, y][3] > 8) > w * 0.85]
    if not rows:
        raise SystemExit("no ground line found - is this the right artwork?")
    # y > 195 keeps the cap brim, which reaches this far left in poses 3-5,
    # out of the laptop measurement.
    lap = min(x for y in range(196, rows[0] - 1) for x in range(w)
              if kind(px[x, y]) == "grey")
    return rows, lap


def main(src):
    bodies = []
    for i in range(1, 6):
        im = load(src, i)
        rows, lap = anchors(im)
        dx, dy = REF_LAP - lap, REF_G - rows[0]
        canvas = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
        canvas.alpha_composite(im, (dx, dy))
        body = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        body.alpha_composite(canvas.crop(CROP), (PAD_X, PAD_Y))
        bodies.append(body)
        print(f"pose {i}: registered dx={dx:+d} dy={dy:+d} "
              f"(ground rows {rows[0]}..{rows[-1]}, laptop x={lap})")

    # One canonical ground band, sampled per row across every pose so the
    # rule keeps its anti-aliased profile while being identical in all cells.
    profile = {}
    for y in GROUND_BAND:
        votes = Counter()
        for body in bodies:
            bp = body.load()
            row = [bp[x, y] for x in range(CELL_W) if bp[x, y][3] > 8]
            if len(row) > CELL_W * 0.60:
                votes[Counter(row).most_common(1)[0][0]] += 1
        if votes:
            profile[y] = votes.most_common(1)[0][0]
    if not profile:
        raise SystemExit("could not sample the ground line")
    fallback = profile[sorted(profile)[len(profile) // 2]]
    for y in GROUND_BAND:
        profile.setdefault(y, fallback)

    base_cells = []
    for body in bodies:
        cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        cp = cell.load()
        for y in GROUND_BAND:               # band first, pose composited over it
            for x in range(CELL_W):
                cp[x, y] = profile[y]
        cell.alpha_composite(body)
        base_cells.append(cell)

    # Un-occluded laptop, reconstructed from the union of all five poses: each
    # one hides a different part of it behind the arms, so together they cover
    # it. This is what the hands reveal as they lift.
    plate = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    pl = plate.load()
    votes = {}
    for cell in base_cells:
        cp = cell.load()
        for x in range(CELL_W):
            for y in range(CUT_Y, GROUND_BAND[0]):
                if kind(cp[x, y]) == "grey":
                    votes.setdefault((x, y), Counter())[cp[x, y]] += 1
    for (x, y), c in votes.items():
        pl[x, y] = c.most_common(1)[0][0]
    print(f"\nlaptop plate reconstructed from 5 poses: {len(votes)} px")

    # Grid: 5 pose COLUMNS x 8 ROWS, where row = blink * 4 + lift. The two
    # axes are independent transforms at runtime, which is what lets the hand
    # rhythm, the blink and the pose all run on their own timers.
    sheet = Image.new("RGBA", (CELL_W * 5, CELL_H * len(LIFTS) * 2),
                      (0, 0, 0, 0))
    for idx, cell in enumerate(base_cells):
        tl = torso_left(cell)
        print(f"pose {idx + 1}: torso starts at x={tl}, arms lifted over x<{tl - ARM_GAP}")
        for li, k in enumerate(LIFTS):
            raised = lift_hands(cell, k, plate)
            shut = close_eyes(raised)
            sheet.alpha_composite(raised, (CELL_W * idx, CELL_H * li))
            sheet.alpha_composite(shut, (CELL_W * idx, CELL_H * (len(LIFTS) + li)))

    # Invariants the CSS depends on, checked on every cell of every row.
    rows = len(LIFTS) * 2
    base = None
    for row in range(rows):
        for i in range(5):
            c = sheet.crop((CELL_W * i, CELL_H * row,
                            CELL_W * (i + 1), CELL_H * (row + 1)))
            cp = c.load()
            assert not any(cp[x, 0][3] for x in range(CELL_W)), \
                f"r{row} cell {i + 1} touches the top edge - it would clip"
            assert not any(cp[x, CELL_H - 1][3] for x in range(CELL_W)), \
                f"r{row} cell {i + 1} touches the bottom edge - it would clip"
            full = [y for y in range(CELL_H)
                    if all(cp[x, y][3] for x in range(CELL_W))]
            base = base or full
            assert full == base, \
                f"r{row} cell {i + 1} ground band differs: {full} vs {base}"
    print(f"all {rows * 5} cells share ground rows {base[0]}..{base[-1]}, none clip")

    # A blink must differ from its eyes-open twin ONLY around the eyes, and a
    # lift must differ from lift 0 ONLY left of the torso and above the ground.
    for i in range(5):
        boxes = [padded(b) for b in eye_rects(base_cells[i])]
        tl = torso_left(base_cells[i]) - ARM_GAP
        for li in range(len(LIFTS)):
            o = sheet.crop((CELL_W * i, CELL_H * li,
                            CELL_W * (i + 1), CELL_H * (li + 1))).load()
            s = sheet.crop((CELL_W * i, CELL_H * (len(LIFTS) + li),
                            CELL_W * (i + 1),
                            CELL_H * (len(LIFTS) + li + 1))).load()
            stray = [(x, y) for x in range(CELL_W) for y in range(CELL_H)
                     if o[x, y] != s[x, y]
                     and not any(b[0] <= x < b[2] and b[1] <= y < b[3]
                                 for b in boxes)]
            assert not stray, (f"pose {i + 1} lift {LIFTS[li]}: blink changed "
                               f"{len(stray)} px outside the eyes")
        z = sheet.crop((CELL_W * i, 0, CELL_W * (i + 1), CELL_H)).load()
        for li in range(1, len(LIFTS)):
            o = sheet.crop((CELL_W * i, CELL_H * li,
                            CELL_W * (i + 1), CELL_H * (li + 1))).load()
            diff = [(x, y) for x in range(CELL_W) for y in range(CELL_H)
                    if z[x, y] != o[x, y]]
            stray = [(x, y) for (x, y) in diff
                     if x >= tl or y >= GROUND_BAND[0]]
            assert not stray, (f"pose {i + 1} lift {LIFTS[li]}: changed "
                               f"{len(stray)} px in the torso / feet / ground")
            print(f"pose {i + 1} lift {LIFTS[li]:2d}px: {len(diff):5d} px moved, "
                  f"all left of x={tl} and above the ground line")

    # Authored at full res, shipped at half: the loader renders at <=150px, so
    # 289px cells are still ~2x oversampled, and halving keeps the sheet's
    # largest dimension well inside the 4096px texture cap of older mobile GPUs.
    #
    # Downscaled CELL BY CELL, not as one image. LANCZOS has a support of a few
    # source pixels, so resizing the assembled sheet lets each cell's edge pull
    # in its neighbour's - which put a faint ghost of the row above into every
    # cell's top gutter and silently broke both the "transparent gutter" and the
    # "a lift differs from rest only at the arm" invariants asserted above.
    # Resizing each cell in isolation keeps every one of them exact.
    cw, ch = CELL_W // SCALE, CELL_H // SCALE
    small = Image.new("RGBA", (cw * 5, ch * rows), (0, 0, 0, 0))
    for row in range(rows):
        for i in range(5):
            src = sheet.crop((CELL_W * i, CELL_H * row,
                              CELL_W * (i + 1), CELL_H * (row + 1)))
            dst = src.resize((cw, ch), Image.LANCZOS)
            # LANCZOS reaches a few source pixels past its footprint, so it
            # also smears content into rows/columns that were empty in the
            # source. A destination row is gutter only if EVERY source row it
            # covers was empty; those are forced back to fully transparent so
            # the gutter invariant holds on the shipped pixels too. Rows that
            # cover any content (e.g. the one straddling the ground line) are
            # left exactly as resampled.
            sp_, dp = src.load(), dst.load()
            for d in range(ch):
                if any(sp_[x, y][3] for y in range(d * SCALE, d * SCALE + SCALE)
                       for x in range(CELL_W)):
                    continue
                for x in range(cw):
                    dp[x, d] = (0, 0, 0, 0)
            for d in range(cw):
                if any(sp_[x, y][3] for x in range(d * SCALE, d * SCALE + SCALE)
                       for y in range(CELL_H)):
                    continue
                for y in range(ch):
                    dp[d, y] = (0, 0, 0, 0)
            small.paste(dst, (cw * i, ch * row))
    sheet = small

    # Re-assert on the SHIPPED pixels, not just the authored ones: the gutters
    # must survive the downscale, or the stepped translate can expose a sliver
    # of a neighbouring cell at the window edge.
    sp = sheet.load()
    for row in range(rows):
        for i in range(5):
            for y in (ch * row, ch * (row + 1) - 1):
                assert not any(sp[cw * i + x, y][3] for x in range(cw)), \
                    f"shipped r{row} cell {i + 1}: gutter row {y} is not clear"

    out = os.path.normpath(DEST)
    sheet.save(out, optimize=True)
    print(f"\nwrote {out}  {sheet.size}  cell {CELL_W // SCALE}x{CELL_H // SCALE}"
          f"  5 cols x {rows} rows  {os.path.getsize(out)} bytes"
          f"  decoded {sheet.size[0] * sheet.size[1] * 4 / 1e6:.2f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
