// The Playwright `test` the specs use: before each test, it serves
// `fundsData` as data/funds.json instead of the committed file. By default
// that is the data from expected.js, in which some funds always pass, so the
// specs don't depend on how many funds pass on the committed day. A describe
// block can serve other data with `test.use({ fundsData })`, or the committed
// file as it is with `test.use({ fundsData: null })`. A spec's own
// page.route for data/funds.json is registered later, so it takes over.
// Remove a spec's own routes with page.unroute: page.unrouteAll() would
// remove this one too, and the page would load the committed file.
import { test as base, expect } from "@playwright/test";
import { data } from "./expected.js";

// Each data file as JSON text, made once.
const bodies = new WeakMap();
const body = (fundsData) => {
  if (!bodies.has(fundsData)) bodies.set(fundsData, JSON.stringify(fundsData));
  return bodies.get(fundsData);
};

export const test = base.extend({
  fundsData: [data, { option: true }],
  serveFundsData: [
    async ({ page, fundsData }, use) => {
      if (fundsData) {
        await page.route("**/data/funds.json", (route) =>
          route.fulfill({ contentType: "application/json", body: body(fundsData) }),
        );
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
