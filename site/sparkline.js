// A small line of each fund's daily prices over the last four weeks, for the
// table's "4 weeks" column. A fund's "prices" list has one price (or null) per
// date in the data file's "priceDates", as in sharpe.js.
//
// Each line is scaled to its own fund's lowest and highest price, so the
// heights of two rows can't be compared, only the shape of each one.

// The chart's size in the SVG's own units (the viewBox), matching its size on
// the page in pixels.
export const WIDTH = 80;
export const HEIGHT = 20;
// Room around the line so the stroke isn't cut off at the edges.
export const PADDING = 1.5;

const isPrice = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;

// Rounds a coordinate to two decimals, so the SVG stays short.
const round = (value) => Math.round(value * 100) / 100;

// The line for a fund's prices, spread over `days` dates (the number of
// priceDates in the file), or null with fewer than two valid prices. Returns
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
