#!/usr/bin/env python3
"""Generate the Chrome Web Store promo tiles as exact-size HTML pages.

The tiles are branding graphics rather than product screenshots, so they are built
from the extension's own tokens (public/tokens.css) and its committed logo.
"""
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = pathlib.Path(__file__).resolve().parent / "tiles"
OUT.mkdir(parents=True, exist_ok=True)

LOGO = "data:image/png;base64," + base64.b64encode(
    (ROOT / "public/icons/icon-128.png").read_bytes()
).decode()

# The logo's own stroke stops, in order: accent -> ok -> warn -> danger.
STOPS = "#2f81f7, #16a34a, #d97706, #dc2626"

COMMON = f"""
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{ overflow: hidden; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
    background: #16181d;
    color: #e9edf5;
    -webkit-font-smoothing: antialiased;
  }}
  .stage {{
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(120% 140% at 12% 0%, #232833 0%, #16181d 55%, #101216 100%);
  }}
  .stage::after {{
    content: "";
    position: absolute;
    inset: auto 0 0 0;
    height: 4px;
    background: linear-gradient(90deg, {STOPS});
  }}
  .wordmark {{ font-weight: 700; letter-spacing: -0.02em; }}
  .tagline {{ color: #9aa4b2; font-weight: 400; }}
  .tab {{
    display: flex;
    align-items: center;
    gap: 12px;
    background: #0e1116;
    border: 1px solid #2b323d;
    border-radius: 10px;
  }}
  .favicon {{
    display: grid;
    place-items: center;
    font-weight: 700;
    color: #fff;
    border-radius: 5px;
    flex: none;
  }}
  .tab-title {{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .prefix {{ font-weight: 700; }}
  .rest {{ color: #9aa4b2; }}
"""

SMALL = f"""<style>
  {COMMON}
  .stage {{ width: 440px; height: 280px; display: grid; place-items: center; }}
  .inner {{ display: flex; flex-direction: column; align-items: center; gap: 18px; }}
  .logo {{ width: 92px; height: 92px; border-radius: 20px; display: block; }}
  .wordmark {{ font-size: 42px; line-height: 1; }}
  .tagline {{ font-size: 15px; line-height: 1.35; text-align: center; max-width: 320px; }}
</style>
<div class="stage">
  <div class="inner">
    <img class="logo" src="{LOGO}" alt="">
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
      <div class="wordmark">Colorway</div>
      <div class="tagline">Tell your environments apart at a glance</div>
    </div>
  </div>
</div>
"""

MARQUEE = f"""<style>
  {COMMON}
  .stage {{
    width: 1400px; height: 560px;
    display: grid; grid-template-columns: 1.05fr 1fr; align-items: center;
    gap: 56px; padding: 0 84px;
  }}
  /* Brand-colored wash so the wide format does not read as empty space. */
  .stage::before {{
    content: "";
    position: absolute; inset: 0;
    background:
      radial-gradient(46% 70% at 8% 22%, rgba(47, 129, 247, 0.20) 0%, transparent 70%),
      radial-gradient(40% 62% at 78% 84%, rgba(220, 38, 38, 0.16) 0%, transparent 72%),
      radial-gradient(34% 54% at 88% 12%, rgba(22, 163, 74, 0.14) 0%, transparent 70%);
  }}
  .left, .right {{ position: relative; z-index: 1; }}
  .left {{ display: flex; flex-direction: column; gap: 30px; }}
  .brand {{ display: flex; align-items: center; gap: 28px; }}
  .logo {{
    width: 116px; height: 116px; border-radius: 26px; display: block;
    box-shadow: 0 18px 44px rgba(0, 0, 0, 0.55);
  }}
  .wordmark {{ font-size: 82px; line-height: 1; }}
  .tagline {{ font-size: 26px; line-height: 1.45; max-width: 560px; color: #b6bfcc; }}
  .right {{ display: flex; flex-direction: column; gap: 22px; align-items: flex-end; }}
  .tab {{
    width: 490px; padding: 18px 20px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
  }}
  .favicon {{ width: 32px; height: 32px; font-size: 13px; }}
  .tab-title {{ font-size: 19px; }}
  .caption {{
    font-size: 14px; color: #7f8a99; letter-spacing: 0.12em;
    text-transform: uppercase; align-self: flex-end; margin-top: 6px;
  }}
</style>
<div class="stage">
  <div class="left">
    <div class="brand">
      <img class="logo" src="{LOGO}" alt="">
      <div class="wordmark">Colorway</div>
    </div>
    <div class="tagline">
      Recolor the parts of a site you pick and mark its tab, so a production
      dashboard never looks like staging again.
    </div>
  </div>
  <div class="right">
    <div class="tab">
      <div class="favicon" style="background:#dc2626">PR</div>
      <div class="tab-title"><span class="prefix">[PROD]</span> <span class="rest">Checkout API - Overview</span></div>
    </div>
    <div class="tab">
      <div class="favicon" style="background:#16a34a">ST</div>
      <div class="tab-title"><span class="prefix">[STAGING]</span> <span class="rest">Checkout API - Overview</span></div>
    </div>
    <div class="caption">same site &middot; told apart</div>
  </div>
</div>
"""

(OUT / "tile-440x280.html").write_text(SMALL)
(OUT / "tile-1400x560.html").write_text(MARQUEE)
print(OUT / "tile-440x280.html")
print(OUT / "tile-1400x560.html")
