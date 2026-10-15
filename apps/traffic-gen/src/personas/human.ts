import type { Browser } from "playwright";
import { chance, joinUrl, pick, thinkTime, type RunStats } from "../shared.js";

// Headless Chromium stands in for a person: it executes the storefront's
// JavaScript and sends normal browser fetch metadata. Its default UA says
// "HeadlessChrome", which would (correctly) be flagged as a bot, so it
// presents an ordinary desktop Chrome UA instead.
const DESKTOP_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
];

const HUMAN_SEARCHES = ["mug", "bottle", "candle", "notebook", "plant", "socks", "gift", "tote"];

export async function runHuman(browser: Browser, target: string): Promise<RunStats> {
  const stats: RunStats = { persona: "human-browser", variant: "browse", requests: 0, errors: 0, ordered: false };
  const context = await browser.newContext({
    userAgent: pick(DESKTOP_UAS),
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: { "X-Synthetic-Persona": stats.persona },
  });
  const page = await context.newPage();
  page.on("request", () => stats.requests++);
  page.on("response", (r) => {
    if (r.status() >= 400) stats.errors++;
  });

  try {
    await page.goto(target, { waitUntil: "networkidle" });
    await thinkTime();

    if (chance(0.5)) {
      stats.variant = "search";
      await page.getByPlaceholder("Search products...").pressSequentially(pick(HUMAN_SEARCHES), { delay: 120 });
      await thinkTime(800, 3_000);
    }

    const cards = page.locator('a[href^="/products/"]');
    const hasCards = () => cards.first().waitFor({ timeout: 4_000 }).then(() => true, () => false);
    if (!(await hasCards())) {
      // Nothing matched: a person clears the box and browses instead.
      stats.variant = "search-miss";
      await page.getByPlaceholder("Search products...").fill("");
      await thinkTime(500, 1_500);
      await hasCards();
    }
    const count = await cards.count();
    if (count === 0) return { ...stats, note: "no products listed" };

    await cards.nth(Math.floor(Math.random() * count)).click();
    await page.waitForLoadState("networkidle");
    await thinkTime(2_000, 9_000);

    // Most people browse and leave.
    if (!chance(0.45)) return { ...stats, variant: `${stats.variant}-bounce` };

    await page.getByRole("button", { name: "Add to cart" }).click();
    await thinkTime(1_000, 3_000);

    if (chance(0.4)) {
      await page.goto(joinUrl(target, "/"), { waitUntil: "networkidle" });
      await thinkTime();
      const again = await cards.count();
      if (again > 0) {
        await cards.nth(Math.floor(Math.random() * again)).click();
        await page.waitForLoadState("networkidle");
        await thinkTime();
        await page.getByRole("button", { name: "Add to cart" }).click();
        await thinkTime(800, 2_000);
      }
    }

    await page.getByRole("link", { name: /Cart/ }).click();
    await page.waitForLoadState("networkidle");
    await thinkTime(1_500, 5_000);

    if (!chance(0.6)) return { ...stats, variant: `${stats.variant}-cart-abandon` };

    await page.getByRole("button", { name: /checkout/i }).click();
    await page.waitForLoadState("networkidle");
    await thinkTime(1_500, 4_000);
    await page.getByPlaceholder("you@example.com").pressSequentially(`shopper${Math.floor(Math.random() * 1e5)}@example.com`, { delay: 60 });
    await thinkTime(800, 2_500);
    await page.getByRole("button", { name: "Place order" }).click();
    await page.waitForURL(/\/orders\//, { timeout: 15_000 });
    stats.ordered = true;
    stats.variant = `${stats.variant}-purchase`;
    await thinkTime(1_000, 3_000);
    return stats;
  } catch (err) {
    return { ...stats, errors: stats.errors + 1, note: (err as Error).message.split("\n")[0] };
  } finally {
    await context.close();
  }
}
