// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEIGHT, PADDING, WIDTH, polylinePoints, sparkline, sparklineLabel } from "../site/sparkline.js";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const LEFT = PADDING;
const RIGHT = WIDTH - PADDING;
const TOP = PADDING;
const BOTTOM = HEIGHT - PADDING;

test("spreads the prices over the width, lowest at the bottom and highest at the top", () => {
  const line = sparkline([100, 110, 105]);
  assert.deepEqual(line.segments, [
    [
      [LEFT, BOTTOM],
      [WIDTH / 2, TOP],
      [RIGHT, HEIGHT / 2],
    ],
  ]);
  close(line.change, 0.05);
});

test("places each price by its date among all the dates", () => {
  // Four dates, but the fund has no price on the last one.
  const line = sparkline([100, 101, 102], 4);
  const step = (WIDTH - 2 * PADDING) / 3;
  assert.deepEqual(
    line.segments[0].map(([x]) => x),
    [LEFT, LEFT + step, LEFT + 2 * step].map((x) => Math.round(x * 100) / 100),
  );
});

test("a missing price in the middle splits the line into two segments", () => {
  const line = sparkline([100, 102, null, 104, 106]);
  assert.equal(line.segments.length, 2);
  assert.deepEqual(
    line.segments.map((segment) => segment.length),
    [2, 2],
  );
  // No point is drawn at the missing date.
  const xs = line.segments.flat().map(([x]) => x);
  assert.ok(!xs.includes(WIDTH / 2), xs.join());
  close(line.change, 0.06);
});

test("zero, negative and non-numeric prices are gaps too", () => {
  for (const gap of [0, -1, undefined, Number.NaN, Infinity, "101"]) {
    const line = sparkline([100, gap, 102, 103]);
    assert.equal(line.segments.length, 2, String(gap));
    assert.deepEqual(
      line.segments.map((segment) => segment.length),
      [1, 2],
      String(gap),
    );
  }
});

test("gaps at the ends don't make empty segments", () => {
  const line = sparkline([null, null, 100, 101, null]);
  assert.equal(line.segments.length, 1);
  assert.equal(line.segments[0].length, 2);
  close(line.change, 0.01);
});

test("equal prices draw a flat line through the middle, without NaN", () => {
  const line = sparkline([5, 5, null, 5, 5]);
  for (const [x, y] of line.segments.flat()) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.equal(y, HEIGHT / 2);
  }
  assert.equal(line.change, 0);
  for (const segment of line.segments) assert.doesNotMatch(polylinePoints(segment), /NaN|Infinity/);
});

test("no line with fewer than two valid prices", () => {
  assert.equal(sparkline([]), null);
  assert.equal(sparkline([100]), null);
  assert.equal(sparkline([null, 100, null, 0]), null);
  assert.equal(sparkline(undefined), null);
  assert.equal(sparkline(null), null);
});

test("every point stays inside the viewBox", () => {
  const prices = [3.6, 3.61, null, 3.59, 3.7, 0, 3.65, 3.66, 3.4, 3.8];
  for (const [x, y] of sparkline(prices, 21).segments.flat()) {
    assert.ok(x >= LEFT && x <= RIGHT, `x ${x}`);
    assert.ok(y >= TOP && y <= BOTTOM, `y ${y}`);
  }
});

test("polyline points join the coordinates, and draw a lone price as a dot", () => {
  assert.equal(
    polylinePoints([
      [1.5, 18.5],
      [5.35, 10],
    ]),
    "1.5,18.5 5.35,10",
  );
  assert.equal(polylinePoints([[40, 10]]), "40,10 40,10");
});

test("the label says up, down or unchanged with the change in percent", () => {
  assert.equal(sparklineLabel(0.0231), "Price over 4 weeks: up 2.31%");
  assert.equal(sparklineLabel(-0.0512), "Price over 4 weeks: down 5.12%");
  assert.equal(sparklineLabel(12.345), "Price over 4 weeks: up 1,234.50%");
  assert.equal(sparklineLabel(0), "Price over 4 weeks: unchanged");
  // Rounds to 0.00%.
  assert.equal(sparklineLabel(0.00004), "Price over 4 weeks: unchanged");
  assert.equal(sparklineLabel(-0.00004), "Price over 4 weeks: unchanged");
});
