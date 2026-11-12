"""
Builds assets/share-v3.jpg: the 1200x630 link-preview image used by WhatsApp,
iMessage, LinkedIn, X etc.

It deliberately shows no live prices (chat apps cache previews for days), only
the Inverika branding and a stylised look at the dashboard.

Usage:  python scripts/make_share_image.py <fonts-dir>
The fonts dir needs Inter.ttf (variable) and SairaStencilOne.ttf from Google Fonts.
Needs Pillow:  pip install pillow
"""
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

FONTS = Path(sys.argv[1] if len(sys.argv) > 1 else "fonts")
OUT = Path(__file__).resolve().parent.parent / "assets" / "share-v3.jpg"  # new name = apps fetch it fresh

S = 2                      # supersample, downscaled at the end
W, H = 1200 * S, 630 * S
NAVY = (11, 15, 26)
CARD = (17, 22, 30)
CARD2 = (21, 27, 37)
LINE = (35, 44, 58)
INK = (238, 242, 248)
INK2 = (163, 173, 191)
INK3 = (108, 119, 137)
UP = (34, 197, 94)
DOWN = (240, 82, 79)
ACCENT = (91, 140, 255)


def px(v):
    return int(round(v * S))


def inter(size, weight="Regular"):
    f = ImageFont.truetype(str(FONTS / "Inter.ttf"), px(size))
    f.set_variation_by_name(weight)
    return f


def saira(size):
    return ImageFont.truetype(str(FONTS / "SairaStencilOne.ttf"), px(size))


def spaced(draw, xy, text, font, fill, tracking):
    """Draw text with letter-spacing (tracking in px at 1x)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + px(tracking)
    return x


def spaced_width(draw, text, font, tracking):
    return sum(draw.textlength(c, font=font) for c in text) + px(tracking) * (len(text) - 1)


def glow(img, center, radius, color, alpha):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = px(center[0]), px(center[1])
    r = px(radius)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (int(255 * alpha),))
    layer = layer.filter(ImageFilter.GaussianBlur(px(radius) * 0.55))
    img.paste(layer, (0, 0), layer)


def mark_mask(height):
    """Inverika mark (same geometry as assets/inverika-mark.svg) as an L mask."""
    k = px(height) / 100.0
    w, h = int(104 * k) + 4, int(100 * k) + 4
    X = lambda v: v * k  # noqa: E731

    def blank():
        return Image.new("L", (w, h), 0)

    ring = blank()
    d = ImageDraw.Draw(ring)
    ro, ri = 39 + 2.8, 39 - 2.8
    d.ellipse([X(50 - ro), X(50 - ro), X(50 + ro), X(50 + ro)], fill=255)
    d.ellipse([X(50 - ri), X(50 - ri), X(50 + ri), X(50 + ri)], fill=0)
    d.line([X(58), X(37.8), X(101), X(15.6)], fill=0, width=max(1, int(12 * k)))

    bars = blank()
    b = ImageDraw.Draw(bars)
    b.rectangle([X(23), X(28), X(29.2), X(90)], fill=255)
    for x in (34, 45.2, 56.4, 67.6):
        b.rectangle([X(x), X(10), X(x + 7.2), X(92)], fill=255)
    cut = blank()
    ImageDraw.Draw(cut).polygon([(0, 0), (X(104), 0), (X(104), X(19.2)), (0, X(63.5))], fill=255)
    stem = blank()
    ImageDraw.Draw(stem).rectangle([X(22), 0, X(30), X(100)], fill=255)
    bars = ImageChops.subtract(bars, ImageChops.subtract(cut, stem))
    clip = blank()
    ImageDraw.Draw(clip).ellipse([X(17.5), X(17.5), X(82.5), X(82.5)], fill=255)
    bars = ImageChops.multiply(bars, clip)

    arrow = blank()
    a = ImageDraw.Draw(arrow)
    a.line([X(26), X(47.2), X(89.6), X(20.1)], fill=255, width=max(1, int(5 * k)))
    a.polygon([(X(100.6), X(15.4)), (X(86.85), X(14.8)), (X(91.55), X(25.8))], fill=255)
    return ImageChops.lighter(ImageChops.lighter(ring, bars), arrow)


def rrect(draw, box, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle([px(v) for v in box], radius=px(r), fill=fill, outline=outline, width=px(width))


def shadow(img, box, r, blur=28, alpha=0.55, dy=18):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [px(box[0]), px(box[1] + dy), px(box[2]), px(box[3] + dy)], radius=px(r), fill=(0, 0, 0, int(255 * alpha)))
    blurred = layer.filter(ImageFilter.GaussianBlur(px(blur))); img.paste(blurred, (0, 0), blurred)


def mix(c1, c2, t):
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def main():
    img = Image.new("RGB", (W, H), NAVY)

    # backdrop: soft glows + faint grid
    glow(img, (230, 40), 420, (47, 107, 255), 0.30)
    glow(img, (1080, 640), 420, (34, 197, 94), 0.20)
    glow(img, (760, 300), 300, (91, 140, 255), 0.10)
    grid = Image.new("RGBA", img.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(grid)
    for x in range(0, 1200, 40):
        g.line([px(x), 0, px(x), H], fill=(255, 255, 255, 9), width=1)
    for y in range(0, 630, 40):
        g.line([0, px(y), W, px(y)], fill=(255, 255, 255, 9), width=1)
    img.paste(grid, (0, 0), grid)

    d = ImageDraw.Draw(img, "RGBA")

    # ---------------------------------------------------------- left: brand + pitch
    m = mark_mask(70)
    img.paste(Image.new("RGBA", m.size, INK + (255,)), (px(70), px(58)), m)
    word = saira(42)
    spaced(d, (px(160), px(60)), "INVERIKA", word, INK, 5)
    ww = spaced_width(d, "INVERIKA", word, 5)
    cap = inter(13, "SemiBold")
    cw = spaced_width(d, "CAPITAL", cap, 15)
    spaced(d, (px(160) + (ww - cw) / 2, px(110)), "CAPITAL", cap, INK2, 15)

    # live pill
    pill_font = inter(14, "SemiBold")
    label = "UPDATED EVERY 15 MIN IN MARKET HOURS"
    lw = d.textlength(label, font=pill_font) / S
    rrect(d, (70, 172, 70 + lw + 46, 204), 16, fill=(34, 197, 94, 30), outline=(34, 197, 94, 110), width=1)
    d.ellipse([px(86), px(183), px(96), px(193)], fill=UP)
    d.text((px(106), px(179)), label, font=pill_font, fill=(150, 235, 180))

    # headline
    h1 = inter(74, "ExtraBold")
    d.text((px(66), px(222)), "Market", font=h1, fill=INK)
    # "Matters." in a green→blue gradient
    sweep_box = d.textbbox((px(66), px(304)), "Matters.", font=h1)
    grad = Image.new("RGBA", (sweep_box[2] - sweep_box[0], sweep_box[3] - sweep_box[1]))
    gd = ImageDraw.Draw(grad)
    for x in range(grad.width):
        gd.line([x, 0, x, grad.height], fill=mix(UP, (96, 165, 250), x / max(1, grad.width)) + (255,))
    tmask = Image.new("L", img.size, 0)
    ImageDraw.Draw(tmask).text((px(66), px(304)), "Matters.", font=h1, fill=255)
    tmask = tmask.crop(sweep_box)
    img.paste(grad, sweep_box[:2], tmask)

    sub = inter(23, "Medium")
    d.text((px(70), px(410)), "India first, global next. Nifty 500,", font=sub, fill=INK2)
    d.text((px(70), px(442)), "sectors, movers and a next-day outlook.", font=sub, fill=INK2)

    chip_font = inter(16, "SemiBold")
    x, y = 70, 500
    for i, t in enumerate(["Nifty 500 & Sensex", "Sector heatmap", "Large · Mid · Small", "Global & FX"]):
        tw = d.textlength(t, font=chip_font) / S
        if x + tw + 32 > 560:
            x, y = 70, y + 46
        rrect(d, (x, y, x + tw + 30, y + 36), 18, fill=(255, 255, 255, 14), outline=(255, 255, 255, 40))
        d.text((px(x + 15), px(y + 8)), t, font=chip_font, fill=INK)
        x += tw + 42

    # ---------------------------------------------------------- right: dashboard preview card
    cx0, cy0, cx1, cy1 = 612, 54, 1146, 584
    shadow(img, (cx0, cy0, cx1, cy1), 24)
    d = ImageDraw.Draw(img, "RGBA")
    rrect(d, (cx0, cy0, cx1, cy1), 24, fill=CARD + (255,), outline=LINE + (255,), width=1)

    # card header
    d.text((px(cx0 + 26), px(cy0 + 22)), "Nifty 500", font=inter(17, "SemiBold"), fill=INK2)
    up_chip = "▲ Market up"
    cf = inter(14, "Bold")
    tw = d.textlength(up_chip, font=cf) / S
    rrect(d, (cx0 + 26, cy0 + 52, cx0 + 26 + tw + 20, cy0 + 80), 8, fill=(34, 197, 94, 36))
    d.text((px(cx0 + 36), px(cy0 + 57)), up_chip, font=cf, fill=UP)
    # range tabs
    tabs = ["1D", "1M", "3M", "6M", "1Y"]
    tx = cx1 - 26 - 5 * 40
    rrect(d, (tx - 4, cy0 + 20, cx1 - 22, cy0 + 50), 9, fill=(255, 255, 255, 10), outline=LINE + (255,))
    for i, t in enumerate(tabs):
        if i == 0:
            rrect(d, (tx, cy0 + 24, tx + 36, cy0 + 46), 7, fill=(255, 255, 255, 30))
        d.text((px(tx + 18), px(cy0 + 35)), t, font=inter(12, "SemiBold"), fill=INK if i == 0 else INK3, anchor="mm")
        tx += 40

    # area chart (a smooth upward path with realistic wiggle)
    ch_x0, ch_x1, ch_y0, ch_y1 = cx0 + 26, cx1 - 26, cy0 + 96, cy0 + 262
    n = 90
    pts = []
    for i in range(n):
        t = i / (n - 1)
        v = 0.18 + 0.62 * (t ** 1.3) + 0.06 * math.sin(t * 17) + 0.035 * math.sin(t * 41 + 1) - 0.08 * math.exp(-((t - .55) / .07) ** 2)
        pts.append((ch_x0 + t * (ch_x1 - ch_x0), ch_y1 - v * (ch_y1 - ch_y0)))
    for gy in range(4):  # grid
        yy = ch_y0 + gy * (ch_y1 - ch_y0) / 3
        d.line([px(ch_x0), px(yy), px(ch_x1), px(yy)], fill=(255, 255, 255, 14), width=1)
    fill_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fl = ImageDraw.Draw(fill_layer)
    poly = [(px(x), px(y)) for x, y in pts] + [(px(ch_x1), px(ch_y1)), (px(ch_x0), px(ch_y1))]
    fmask = Image.new("L", img.size, 0)
    ImageDraw.Draw(fmask).polygon(poly, fill=255)
    for yy in range(px(ch_y0 - 10), px(ch_y1) + 1):
        a = int(70 * (1 - (yy - px(ch_y0 - 10)) / (px(ch_y1) - px(ch_y0 - 10))))
        fl.line([0, yy, W, yy], fill=UP + (max(0, a),))
    img.paste(fill_layer, (0, 0), ImageChops.multiply(fmask, fill_layer.getchannel("A")))
    d = ImageDraw.Draw(img, "RGBA")
    d.line([(px(x), px(y)) for x, y in pts], fill=UP, width=px(3.2), joint="curve")
    ex, ey = pts[-1]
    d.ellipse([px(ex - 9), px(ey - 9), px(ex + 9), px(ey + 9)], fill=UP + (60,))
    d.ellipse([px(ex - 5), px(ey - 5), px(ex + 5), px(ey + 5)], fill=UP, outline=CARD, width=px(2))

    # bottom-left: sector heatmap
    hx0, hy0, hx1, hy1 = cx0 + 22, cy0 + 286, cx0 + 300, cy1 - 22
    rrect(d, (hx0, hy0, hx1, hy1), 16, fill=CARD2 + (255,), outline=LINE + (255,))
    d.text((px(hx0 + 16), px(hy0 + 14)), "SECTOR HEATMAP", font=inter(11.5, "Bold"), fill=INK3)
    sectors = [("PSU Bank", 2.9), ("Auto", 2.1), ("Bank", 1.8), ("FMCG", 1.1), ("Metal", 0.9),
               ("Energy", 0.6), ("Pharma", -0.4), ("Realty", -0.5), ("IT", -1.2)]
    tw_, th_, gap = (hx1 - hx0 - 32 - 2 * 6) / 3, 50, 6
    for i, (name, v) in enumerate(sectors):
        r_, c_ = divmod(i, 3)
        x0 = hx0 + 16 + c_ * (tw_ + gap)
        y0 = hy0 + 40 + r_ * (th_ + gap)
        k = min(1, abs(v) / 3) ** 0.75
        col = mix((27, 34, 45), UP if v > 0 else DOWN, 0.25 + 0.6 * k)
        rrect(d, (x0, y0, x0 + tw_, y0 + th_), 8, fill=col + (255,))
        d.text((px(x0 + 9), px(y0 + 8)), name, font=inter(12.5, "SemiBold"), fill=INK)
        bar_w = (tw_ - 18) * (0.35 + 0.65 * k)
        rrect(d, (x0 + 9, y0 + 32, x0 + 9 + bar_w, y0 + 38), 3, fill=(255, 255, 255, 110))

    # bottom-right: outlook gauge
    gx0, gy0, gx1, gy1 = cx0 + 312, cy0 + 286, cx1 - 22, cy1 - 22
    rrect(d, (gx0, gy0, gx1, gy1), 16, fill=CARD2 + (255,), outline=LINE + (255,))
    d.text((px(gx0 + 16), px(gy0 + 14)), "NEXT-DAY OUTLOOK", font=inter(11.5, "Bold"), fill=INK3)
    gcx, gcy, gr = (gx0 + gx1) / 2, gy0 + 130, 70
    steps = 60
    for i in range(steps):
        a0 = 180 + i * 180 / steps
        a1 = 180 + (i + 1.4) * 180 / steps
        t = i / (steps - 1)
        col = mix(DOWN, (120, 128, 140), t * 2) if t < .5 else mix((120, 128, 140), UP, (t - .5) * 2)
        d.arc([px(gcx - gr), px(gcy - gr), px(gcx + gr), px(gcy + gr)], a0, a1, fill=col, width=px(13))
    ang = math.radians(180 + 90 + 48)  # pointing to the bullish side
    nx, ny = gcx + (gr - 16) * math.cos(ang), gcy + (gr - 16) * math.sin(ang)
    perp = ang + math.pi / 2
    d.polygon([(px(nx), px(ny)),
               (px(gcx + 5 * math.cos(perp)), px(gcy + 5 * math.sin(perp))),
               (px(gcx - 5 * math.cos(perp)), px(gcy - 5 * math.sin(perp)))], fill=INK)
    d.ellipse([px(gcx - 8), px(gcy - 8), px(gcx + 8), px(gcy + 8)], fill=INK, outline=CARD2, width=px(3))
    d.text((px(gcx), px(gcy + 30)), "Bullish", font=inter(22, "ExtraBold"), fill=UP, anchor="mm")

    # floating "movers" card overlapping the main card for depth
    fx0, fy0, fx1, fy1 = 528, 418, 742, 556
    shadow(img, (fx0, fy0, fx1, fy1), 16, blur=22, alpha=0.6, dy=14)
    d = ImageDraw.Draw(img, "RGBA")
    rrect(d, (fx0, fy0, fx1, fy1), 16, fill=(24, 31, 43, 255), outline=(52, 63, 80, 255))
    d.text((px(fx0 + 16), px(fy0 + 13)), "TOP MOVERS", font=inter(11.5, "Bold"), fill=INK3)
    rows = [(UP, 0.92), (UP, 0.74), (DOWN, 0.58)]
    for i, (col, wv) in enumerate(rows):
        yy = fy0 + 42 + i * 30
        rrect(d, (fx0 + 16, yy + 4, fx0 + 16 + 92 * wv, yy + 12), 4, fill=(255, 255, 255, 60))
        rrect(d, (fx1 - 74, yy, fx1 - 16, yy + 18), 6, fill=col + (50,))
        d.text((px(fx1 - 45), px(yy + 9)), "▲" if col == UP else "▼", font=inter(11, "Bold"), fill=col, anchor="mm")

    out = img.convert("RGB").resize((1200, 630), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # baseline (not progressive) JPEG: some WhatsApp versions fail to show progressive ones
    out.save(OUT, "JPEG", quality=88, optimize=True, progressive=False)
    print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
