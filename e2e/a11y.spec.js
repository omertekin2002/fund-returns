// Accessibility checks: axe-core against WCAG 2.0/2.1 A and AA in each state
// the page can be in, and a keyboard walk that checks every focusable control
// gets a focus outline that stands out from what is behind it.
// Run with: npm run test:e2e (or npx playwright test e2e/a11y.spec.js)
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { data, formatCount, passing, previousData } from "./expected.js";

// The WCAG 2.0 and 2.1 A and AA rules, plus the best-practice rules that keep
// every piece of content inside a landmark and give the page one <main>.
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const LANDMARK_RULES = [
  "landmark-one-main",
  "landmark-no-duplicate-main",
  "landmark-main-is-top-level",
  "landmark-banner-is-top-level",
  "landmark-contentinfo-is-top-level",
  "region",
];

// Each violation as its rule, impact and the elements it found, so a failure
// says what to fix.
const describe = (violations) =>
  violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));

async function expectNoViolations(page) {
  const wcag = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(describe(wcag.violations)).toEqual([]);
  const landmarks = await new AxeBuilder({ page }).withRules(LANDMARK_RULES).analyze();
  expect(describe(landmarks.violations)).toEqual([]);
}

const rows = (page) => page.locator("#funds tbody tr");

// Opens the page and waits until the data has been rendered.
async function open(page) {
  await page.goto("./");
  await expect(page.locator("#pass-sticker")).toHaveText(`${formatCount(passing.length)} funds pass`);
}

// Opens the page with a previous update, so the change summary, the change
// filter and the NEW / LEFT badges show.
async function openWithChanges(page) {
  const { previous } = previousData();
  await page.route("**/data/previous.json", (route) => route.fulfill({ json: previous }));
  await open(page);
  await expect(page.locator("#changes")).toBeVisible();
  await expect(page.locator("#change-filter")).toBeVisible();
}

test.describe("axe finds no WCAG 2.1 A/AA violations", () => {
  // The Excluded and All views have over a thousand rows to check.
  test.slow();

  // Each view at 1280 px, with the change summary and the NEW / LEFT badges.
  for (const [view, badge] of [
    ["passing", "NEW"],
    ["excluded", "LEFT"],
    ["all", "NEW"],
  ]) {
    test(`in the ${view} view at 1280 px, with the change summary and badges`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await openWithChanges(page);
      await page.locator(`[data-view="${view}"]`).click();
      await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#funds tbody .badge", { hasText: badge })).not.toHaveCount(0);
      await expectNoViolations(page);
    });
  }

  test("in the Passing view at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openWithChanges(page);
    await expectNoViolations(page);
  });

  test("when a search matches no fund", async ({ page }) => {
    await open(page);
    await page.locator("#search").fill("no fund is called this");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator("#empty")).toBeVisible();
    await expectNoViolations(page);
  });

  test("when the data is out of date", async ({ page }) => {
    await page.clock.setFixedTime(new Date(new Date(data.fetchedAt).getTime() + 7 * 24 * 60 * 60 * 1000));
    await open(page);
    await expect(page.locator("#stale")).toBeVisible();
    await expectNoViolations(page);
  });

  test("when the data fails to load", async ({ page }) => {
    await page.route("**/data/funds.json", (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto("./");
    await expect(page.locator("#status")).toHaveText("Could not load fund data: HTTP 500");
    await expectNoViolations(page);
  });
});

test("the page has one <main>, and the stale warning and change summary are inside it", async ({ page }) => {
  await page.clock.setFixedTime(new Date(new Date(data.fetchedAt).getTime() + 7 * 24 * 60 * 60 * 1000));
  await openWithChanges(page);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main #stale")).toBeVisible();
  await expect(page.locator("main #changes")).toBeVisible();
  await expect(page.locator("main header, main footer")).toHaveCount(0);
});

// WCAG relative luminance and contrast ratio of two "rgb(…)" / "rgba(…)" colours.
const channels = (color) => color.match(/[\d.]+/g).map(Number);
function luminance(color) {
  const [r, g, b] = channels(color).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("every focusable control shows a focus outline with 3:1 contrast against what is behind it", async ({
  page,
}) => {
  // A previous update adds the change filter and the summary's links.
  await openWithChanges(page);

  // The controls a keyboard user should reach, in any order.
  const expected = await page.evaluate(() =>
    [...document.querySelectorAll("a[href], button, select, input")]
      .filter((el) => !el.disabled && el.checkVisibility())
      .map((el) => el.outerHTML),
  );

  // Tab from the top of the page until focus leaves the page or comes back
  // round, noting each control's outline and the colour behind it.
  const seen = [];
  for (let i = 0; i < expected.length + 5; i += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      // An outline drawn outside the element sits on its parent's background;
      // one drawn inside (negative offset) on its own.
      let behind = parseFloat(style.outlineOffset) < 0 ? el : el.parentElement;
      let background = "rgb(255, 255, 255)";
      for (; behind; behind = behind.parentElement) {
        const color = getComputedStyle(behind).backgroundColor;
        const alpha = color.startsWith("rgba") ? Number(color.match(/[\d.]+/g)[3]) : 1;
        if (alpha > 0) {
          background = color;
          break;
        }
      }
      const text = (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40);
      return {
        html: el.outerHTML,
        label: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} "${text}"`,
        focusVisible: el.matches(":focus-visible"),
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
        outlineColor: style.outlineColor,
        background,
      };
    });
    if (!focus || seen.some((s) => s.html === focus.html)) break;
    seen.push(focus);
  }

  // Tab reached every control, and those include every kind the page has.
  const reached = seen.map((s) => s.html);
  expect([...reached].sort()).toEqual([...expected].sort());
  for (const selector of [
    "[data-view]",
    "#type-filter",
    "#risk-filter",
    "#change-filter",
    "#search",
    "#download-csv",
    "#header-row button",
    "#funds tbody td.col-code a",
    "#changes a",
    ".footer-band a",
  ]) {
    const html = await page.locator(selector).first().evaluate((el) => el.outerHTML);
    expect(reached, `${selector} is reached with Tab`).toContain(html);
  }

  const problems = seen
    .filter(
      (s) =>
        !s.focusVisible ||
        s.outlineStyle === "none" ||
        s.outlineWidth < 2 ||
        contrast(s.outlineColor, s.background) < 3,
    )
    .map((s) => ({
      control: s.label,
      outline: `${s.outlineStyle} ${s.outlineWidth}px ${s.outlineColor}`,
      background: s.background,
      contrast: Math.round(contrast(s.outlineColor, s.background) * 100) / 100,
    }));
  expect(problems).toEqual([]);
});
