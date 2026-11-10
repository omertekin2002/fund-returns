// A small line of each fund's daily prices over the last four weeks, for the
// table's "4 weeks" column. A fund's "prices" list has one price (or null) per
// date in the data file's "priceDates", as in sharpe.js. The file holds more
// dates than the line shows (six months, for the Sharpe ratio), so the line is
// drawn from the last ones only (see recentCount).
//
// Each line is scaled to its own fund's lowest and highest price, so the
// heights of two rows can't be compared, only the shape of each one.

// The chart's size in the SVG's own units (the viewBox), matching its size on
// the page in pixels.
export const WIDTH = 80;
export const HEIGHT = 20;
// Room around the line so the stroke isn't cut off at the edges.
export const PADDING = 1.5;

// The line covers the price dates in this many days up to the last one.
export const RECENT_DAYS = 28;

// How many of the file's price dates ("YYYY-MM-DD", in date order) the line
// shows: the ones at most RECENT_DAYS days before the last. 0 without a list
// of valid dates.
export function recentCount(priceDates) {
  if (!Array.isArray(priceDates) || priceDates.length === 0) return 0;
  const times = priceDates.map((date) => (typeof date === "string" ? Date.parse(`${date}T00:00:00Z`) : NaN));
  if (times.some(Number.isNaN)) return 0;
  const from = times.at(-1) - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return times.filter((time) => time >= from).length;
}

// The last `count` of a fund's prices, the ones the line shows; all of them
// when count is 0 (the price dates are unknown).
export function recentPrices(prices, count) {
  return Array.isArray(prices) && count > 0 ? prices.slice(-count) : prices;
}

const isPrice = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

// Rounds a coordinate to two decimals, so the SVG stays short.
const round = (value) => Math.round(value * 100) / 100;

// The line for a fund's prices, spread over `days` dates (the number of
// price dates the line shows), or null with fewer than two valid prices. Returns
// { segments, change }:
// - segments: lists of [x, y] points in the WIDTH × HEIGHT viewBox, x by the
//   date's position among all dates and y by the price between the fund's own
//   lowest (bottom) and highest (top) price. A missing or non-positive price
//   ends a segment, so no line is drawn across the gap. All-equal prices give
//   a flat line through the middle.
// - change: the change from the first to the last valid price (0.0231 is up
//   2.31%).
export function sparkline(prices, days = prices?.length ?? 0) {
  if (!Array.isArray(prices)) return null;
  const valid = prices.filter(isPrice);
  if (valid.length < 2) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = Math.max(days, prices.length) - 1;
  const x = (day) => round(PADDING + (day / span) * (WIDTH - 2 * PADDING));
  const y = (price) =>
    max === min ? HEIGHT / 2 : round(PADDING + ((max - price) / (max - min)) * (HEIGHT - 2 * PADDING));

  const segments = [];
  let segment = null;
  prices.forEach((price, day) => {
    if (!isPrice(price)) {
      segment = null;
      return;
    }
    if (!segment) {
      segment = [];
      segments.push(segment);
    }
    segment.push([x(day), y(price)]);
  });
  return { segments, change: valid.at(-1) / valid[0] - 1 };
}

// A segment as an SVG polyline's "points" attribute, e.g. "1.5,18.5 5.35,10".
// A single price between two gaps is drawn as a dot: the point twice, shown
// by the stroke's round line cap.
export function polylinePoints(segment) {
  const points = segment.length === 1 ? [segment[0], segment[0]] : segment;
  return points.map(([px, py]) => `${px},${py}`).join(" ");
}

const percentFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// What a screen reader says for a line, e.g. "Price over 4 weeks: up 2.31%".
// A change that rounds to 0.00% is "unchanged".
export function sparklineLabel(change) {
  const percent = percentFormat.format(Math.abs(change) * 100);
  if (percent === "0.00") return "Price over 4 weeks: unchanged";
  return `Price over 4 weeks: ${change > 0 ? "up" : "down"} ${percent}%`;
}
