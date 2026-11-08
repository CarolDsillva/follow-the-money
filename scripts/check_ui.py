"""Click through the main UI changes on the live site and save screenshots. Prints what it finds."""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://followthemoney.137-220-32-178.sslip.io"
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text[:120]))
    page.goto(BASE + "/"); page.wait_for_selector(".mm-node.risk", timeout=60000); time.sleep(2)
    page.screenshot(path=str(out / "a-hero.png"))
    link = page.locator("a.cap-where").first
    print("capability link:", link.get_attribute("href"))
    link.click(); page.wait_for_selector(".casenet", timeout=60000); time.sleep(2)
    print("after click url:", page.url)
    page.goto(BASE + "/?view=incidents"); page.wait_for_selector("tr.rowlink", timeout=60000)
    page.locator("tr.rowlink").last.locator("td").nth(1).click(); time.sleep(3)
    print("row click url:", page.url)
    print("crumbs:", page.locator(".crumbs").inner_text().replace("\n", " "))
    print("plan:", page.locator(".plan .panel-head").inner_text().replace("\n", " ")[:140])
    page.select_option(".persona select", "ap_lead"); time.sleep(0.5)
    page.select_option(".persona select", "warehouse"); time.sleep(0.8)
    print("toast:", page.locator(".role-toast").inner_text().replace("\n", " "))
    print("rolestrip:", page.locator(".rolestrip").inner_text())
    page.screenshot(path=str(out / "b-case.png"))
    page.goto(page.url.split("&")[0] + "&guide=1")
    page.evaluate("Object.keys(sessionStorage).filter(k => k.startsWith('tour-')).forEach(k => sessionStorage.removeItem(k))")
    page.reload(); page.wait_for_selector(".tour-card", timeout=60000); time.sleep(1.5)
    print("tour step 1:", page.locator(".tour-card h3").inner_text())
    page.screenshot(path=str(out / "c-tour.png"))
    page.goto(BASE + "/?view=scan"); page.wait_for_selector(".scan-hero")
    page.get_by_role("button", name="Try it with the sample →").click()
    page.wait_for_selector(".fcard", timeout=60000); time.sleep(2)
    print("findings:", page.locator(".fcard").count())
    page.locator(".fcard").first.click(); time.sleep(2.5)
    print("scan focus caption:", page.locator(".nx-now").inner_text()[:100] if page.locator(".nx-now").count() else "none")
    page.screenshot(path=str(out / "d-scan.png"), full_page=True)
    print("console errors:", errors[:4])
    b.close()
