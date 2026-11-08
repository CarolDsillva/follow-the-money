"""Focused crops for the deck, with the sticky top bar pinned so it can't overlap."""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

B = "https://followthemoney.137-220-32-178.sslip.io"
out = Path(sys.argv[1])
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    c.add_init_script("localStorage.setItem('persona','ap_lead'); sessionStorage.setItem('guide-hidden','1');"
                      "document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.topbar{position:static!important}.tour-hint{display:none!important}';document.head.appendChild(s);});")
    pg = c.new_page()
    pg.goto(f"{B}/?case=INC-0412-C55F&tab=Exposure%20%26%20actions"); pg.wait_for_selector(".approvebar", timeout=60000); time.sleep(2)
    pg.locator(".grid2 > section").first.screenshot(path=str(out / "exposure.png")); print("exposure")
    pg.locator(".actions > li").first.screenshot(path=str(out / "action-card.png")); print("action-card")
    pg.locator(".approvebar").screenshot(path=str(out / "locked.png")); print("locked")
    pg.goto(f"{B}/?case=INC-0412-D650"); pg.wait_for_selector(".rolestrip", timeout=60000); time.sleep(1.5)
    pg.locator(".rolestrip").screenshot(path=str(out / "rolestrip.png")); print("rolestrip")
    b.close()
