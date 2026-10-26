// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStale, istanbulDate, previousWeekday } from "../site/freshness.js";

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
