// Sharpe ratio of each fund over the daily prices in the data file (the last
// four weeks). A fund's "prices" list has one price (or null) per date in the
// file's "priceDates".
//
// The risk-free return for each day is the median return of the money market
// funds that day. It follows the market rate without being updated by hand,
// and covers weekends and holidays, when money market funds earn several
// days of interest at once.

export const RISK_FREE_UMBRELLA = "Para Piyasası Şemsiye Fonu";
export const TRADING_DAYS_PER_YEAR = 252;
// With fewer daily returns than this (a fund launched or missing prices in
// the window) there is no ratio.
export const MIN_RETURNS = 10;

const isPrice = (value) => typeof value === "number" && value > 0;
const isMissing = (value) => value === null || value === undefined;

// Return from each date to the next; null where either price is missing.
export function dailyReturns(prices) {
  if (!prices) return [];
  return prices
    .slice(1)
    .map((price, i) => (isPrice(price) && isPrice(prices[i]) ? price / prices[i] - 1 : null));
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Median daily return of the money market funds, one per daily return.
export function riskFreeReturns(funds) {
  const series = funds
    .filter((fund) => fund.umbrella === RISK_FREE_UMBRELLA)
    .map((fund) => dailyReturns(fund.prices));
  const days = Math.max(0, ...series.map((returns) => returns.length));
  return Array.from({ length: days }, (_, day) =>
    median(series.map((returns) => returns[day]).filter((r) => !isMissing(r))),
  );
}

// Annualised Sharpe ratio: the mean daily return above the risk-free return,
// divided by the standard deviation of that excess return, times √252. Null
// with too few returns or none of them varying.
export function sharpeRatio(prices, riskFree) {
  const excess = dailyReturns(prices)
    .map((r, day) => (isMissing(r) || isMissing(riskFree[day]) ? null : r - riskFree[day]))
    .filter((r) => r !== null);
  if (excess.length < MIN_RETURNS) return null;
  const mean = excess.reduce((sum, r) => sum + r, 0) / excess.length;
  const variance = excess.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (excess.length - 1);
  if (variance === 0) return null;
  return (mean / Math.sqrt(variance)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
