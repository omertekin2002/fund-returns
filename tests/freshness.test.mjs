// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStale, istanbulDate, previousWeekday, pricesBehind, pricesBehindText } from "../site/freshness.js";

// Istanbul is UTC+3 all year, so these UTC times are 10:15 Istanbul time.
const THURSDAY = "2026-10-22T07:15:00Z";
const FRIDAY = "2026-10-23T07:15:36Z";
// `now` values, given in Istanbul time.
const at = (local) => new Date(`${local}+03:00`);

test("Friday's data is fresh over the weekend and on Monday", () => {
  assert.equal(isStale(FRIDAY, at("2026-10-24T12:00:00")), false); // Saturday
  assert.equal(isStale(FRIDAY, at("2026-10-25T23:59:00")), false); // Sunday
  assert.equal(isStale(FRIDAY, at("2026-10-26T09:00:00")), false); // Monday morning
  assert.equal(isStale(FRIDAY, at("2026-10-26T23:59:00")), false); // Monday night
});

test("Friday's data is stale once Monday has gone by", () => {
  assert.equal(isStale(FRIDAY, at("2026-10-27T00:01:00")), true); // Tuesday 00:01
});

test("Thursday's data is stale on Monday and over the weekend", () => {
  assert.equal(isStale(THURSDAY, at("2026-10-26T09:00:00")), true); // Monday: Friday missed
  assert.equal(isStale(THURSDAY, at("2026-10-24T12:00:00")), true); // Saturday
  assert.equal(isStale(THURSDAY, at("2026-10-25T12:00:00")), true); // Sunday
});

test("data is fresh on the day it was fetched and the weekday after", () => {
  assert.equal(isStale(FRIDAY, at("2026-10-23T10:20:00")), false);
  assert.equal(isStale(THURSDAY, at("2026-10-23T17:40:00")), false); // late fallback run
  assert.equal(isStale(THURSDAY, at("2026-10-23T23:59:00")), false);
});

test("dates are Istanbul dates, not UTC dates", () => {
  // Thursday 22:30 UTC is Friday 01:30 in Istanbul.
  assert.equal(istanbulDate(new Date("2026-10-22T22:30:00Z")), "2026-10-23");
  assert.equal(isStale("2026-10-22T22:30:00Z", at("2026-10-26T09:00:00")), false);
  // Thursday 20:59 UTC is still Thursday (23:59) in Istanbul.
  assert.equal(isStale("2026-10-22T20:59:00Z", at("2026-10-26T09:00:00")), true);
  // Monday 22:30 UTC is Tuesday 01:30 in Istanbul: Friday's data is stale.
  assert.equal(isStale(FRIDAY, new Date("2026-10-26T22:30:00Z")), true);
  assert.equal(isStale(FRIDAY, new Date("2026-10-26T20:30:00Z")), false);
});

test("the previous weekday skips weekends", () => {
  assert.equal(previousWeekday("2026-10-26"), "2026-10-23"); // Monday → Friday
  assert.equal(previousWeekday("2026-10-25"), "2026-10-23"); // Sunday → Friday
  assert.equal(previousWeekday("2026-10-24"), "2026-10-23"); // Saturday → Friday
  assert.equal(previousWeekday("2026-10-27"), "2026-10-26"); // Tuesday → Monday
  assert.equal(previousWeekday("2026-11-02"), "2026-10-30"); // across a month
});

test("a missing or invalid fetchedAt is stale and does not throw", () => {
  const now = at("2026-10-26T09:00:00");
  for (const value of [undefined, null, "", "not a date", 42, {}, "2026-13-45T00:00:00Z"]) {
    assert.equal(isStale(value, now), true, `fetchedAt ${JSON.stringify(value)}`);
  }
  assert.equal(istanbulDate(new Date("nope")), null);
});

// Fetch times, given in Istanbul time.
const fetched = (local) => new Date(`${local}+03:00`).toISOString();
const FRIDAY_FETCH = fetched("2026-11-27T10:15:00");
const MONDAY_FETCH = fetched("2026-11-30T10:15:00");

test("prices from the fetch day or the weekday before are not behind", () => {
  assert.equal(pricesBehind(FRIDAY_FETCH, "2026-11-27"), false); // same day
  assert.equal(pricesBehind(FRIDAY_FETCH, "2026-11-26"), false); // one weekday (a holiday)
  assert.equal(pricesBehind(fetched("2026-10-29T10:15:00"), "2026-10-28"), false); // the 2026-10-29 holiday
  assert.equal(pricesBehindText(FRIDAY_FETCH, "2026-11-26"), null);
});

test("prices two or more weekdays before the fetch day are behind", () => {
  assert.equal(pricesBehind(FRIDAY_FETCH, "2026-11-25"), true); // two weekdays
  assert.equal(pricesBehind(FRIDAY_FETCH, "2026-11-20"), true); // a week
  assert.equal(
    pricesBehindText(FRIDAY_FETCH, "2026-11-20"),
    "TEFAS prices end on 20 Nov 2026, before this update on 27 Nov 2026: " +
      "the returns, Sharpe ratios and changes describe that day.",
  );
});

test("weekends are skipped: a Monday fetch allows Friday's prices, not Thursday's", () => {
  assert.equal(pricesBehind(MONDAY_FETCH, "2026-11-27"), false); // Friday
  assert.equal(pricesBehind(MONDAY_FETCH, "2026-11-26"), true); // Thursday
  // A weekend fetch (a manual run) allows Friday's prices too.
  assert.equal(pricesBehind(fetched("2026-11-29T12:00:00"), "2026-11-27"), false);
  assert.equal(pricesBehind(fetched("2026-11-29T12:00:00"), "2026-11-26"), true);
});

test("prices later than the fetch day are not behind", () => {
  assert.equal(pricesBehind(FRIDAY_FETCH, "2026-11-30"), false);
});

test("the fetch day is the Istanbul day, not the UTC day", () => {
  // Monday 22:38 UTC is Tuesday 01:38 in Istanbul (the 00:38 duplicate run):
  // Monday's prices are one weekday behind, Friday's are two.
  const afterMidnight = "2026-11-23T22:38:00Z";
  assert.equal(pricesBehind(afterMidnight, "2026-11-23"), false);
  assert.equal(pricesBehind(afterMidnight, "2026-11-20"), true);
  assert.match(pricesBehindText(afterMidnight, "2026-11-20"), /before this update on 24 Nov 2026/);
  // Monday 20:59 UTC is still Monday (23:59) in Istanbul: Friday's prices are fine.
  assert.equal(pricesBehind("2026-11-23T20:59:00Z", "2026-11-20"), false);
});

test("a missing or invalid fetchedAt or last price date is not behind and does not throw", () => {
  for (const value of [undefined, null, "", "not a date", 42, {}, "2026-13-45T00:00:00Z"]) {
    assert.equal(pricesBehind(value, "2026-11-20"), false, `fetchedAt ${JSON.stringify(value)}`);
    assert.equal(pricesBehindText(value, "2026-11-20"), null);
  }
  for (const value of [undefined, null, "", "20 Nov 2026", "2026-11-31", "2026-11-20T00:00:00Z", 20261120, {}]) {
    assert.equal(pricesBehind(FRIDAY_FETCH, value), false, `last price date ${JSON.stringify(value)}`);
    assert.equal(pricesBehindText(FRIDAY_FETCH, value), null);
  }
});
