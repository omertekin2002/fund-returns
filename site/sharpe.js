// Sharpe ratio of each fund over the daily prices in the data file (the last
// six months). A fund's "prices" list has one price (or null) per date in the
// file's "priceDates".
//
// The risk-free return for each day is the highest of three measures:
// - TLREF, the Turkish lira overnight reference rate (Borsa İstanbul);
// - the central bank's policy rate (the one-week repo rate);
// - the median return of the steady money market funds that day.
// The two rates come from the data file's "riskFreeRates" and accrue over the
// calendar days between price dates, so all three cover weekends and
// holidays, when money market funds earn several days of interest at once.

export const RISK_FREE_UMBRELLA = "Para Piyasası Şemsiye Fonu";
export const TRADING_DAYS_PER_YEAR = 252;
// With fewer daily returns than this (a fund launched or missing prices in
// the window) there is no ratio: about one month of trading days (252 / 12).
export const MIN_RETURNS = 21;

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

// Median of the returns the funds have on each day.
function medianReturns(series) {
  const days = Math.max(0, ...series.map((returns) => returns.length));
  return Array.from({ length: days }, (_, day) =>
    median(series.map((returns) => returns[day]).filter((r) => !isMissing(r))),
  );
}

// A money market fund is left out of the median when one of its daily returns
// is above this many times that day's median of all money market funds.
export const JUMP_FACTOR = 2;

// Median daily return of the steady money market funds, one per daily return.
// A fund with a negative daily return or a jump in the window (a write-down,
// a unit split, a wrong price) is left out, so the median follows the funds
// that only accrue interest.
export function moneyMarketReturns(funds) {
  const series = funds
    .filter((fund) => fund.umbrella === RISK_FREE_UMBRELLA)
    .map((fund) => dailyReturns(fund.prices));
  const typical = medianReturns(series);
  const steady = series.filter((returns) =>
    returns.every((r, day) => isMissing(r) || (r >= 0 && r <= JUMP_FACTOR * typical[day])),
  );
  return medianReturns(steady);
}

const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const time = (date) => (typeof date === "string" ? Date.parse(`${date}T00:00:00Z`) : NaN);

// The return an annual rate earns from each price date to the next. `rates`
// has one rate in percent (or null) per price date; the rate on a date
// accrues, without compounding, over the calendar days to the next date.
export function rateReturns(rates, priceDates) {
  if (!Array.isArray(rates) || !Array.isArray(priceDates)) return [];
  return priceDates.slice(1).map((date, i) => {
    const days = (time(date) - time(priceDates[i])) / MS_PER_DAY;
    const rate = rates[i];
    if (typeof rate !== "number" || !Number.isFinite(rate) || !(days > 0)) return null;
    return ((rate / 100) * days) / DAYS_PER_YEAR;
  });
}

// The three measures of the risk-free return, one list of daily returns each.
// `data` is the data file: its "priceDates" and "riskFreeRates" ({ tlref,
// policy }, annual rates in percent per price date). A file without them has
// only the money market measure.
export function riskFreeMeasures(funds, data) {
  return {
    tlref: rateReturns(data?.riskFreeRates?.tlref, data?.priceDates),
    policy: rateReturns(data?.riskFreeRates?.policy, data?.priceDates),
    moneyMarket: moneyMarketReturns(funds),
  };
}

// The risk-free return for each day: the highest of the measures that have a
// return that day, or null when none has.
export function riskFreeReturns(funds, data) {
  const measures = Object.values(riskFreeMeasures(funds, data));
  const days = Math.max(0, ...measures.map((returns) => returns.length));
  return Array.from({ length: days }, (_, day) => {
    const returns = measures.map((measure) => measure[day]).filter((r) => !isMissing(r));
    return returns.length ? Math.max(...returns) : null;
  });
}

// A ratio worked out from fewer than this share of the window's daily returns
// counts as based on a shorter period (see sharpePeriod). A fund missing a
// few days' prices is still above it.
export const FULL_WINDOW_SHARE = 0.9;
const TRADING_DAYS_PER_MONTH = TRADING_DAYS_PER_YEAR / 12;

// The fund's daily returns above the risk-free return, leaving out the days
// without a fund price or a risk-free return.
function excessReturns(prices, riskFree) {
  return dailyReturns(prices)
    .map((r, day) => (isMissing(r) || isMissing(riskFree[day]) ? null : r - riskFree[day]))
    .filter((r) => r !== null);
}

// How much of the window a fund's ratio is based on: { returns, of, months,
// short }. `returns` is the number of daily returns behind the ratio, `of`
// the number the window offers (the days with a risk-free return), `months`
// the returns in months of trading days (at least 1), and `short` whether
// the ratio covers clearly less than the whole window.
export function sharpePeriod(prices, riskFree) {
  const returns = excessReturns(prices, riskFree).length;
  const of = riskFree.filter((r) => !isMissing(r)).length;
  return {
    returns,
    of,
    months: Math.max(1, Math.round(returns / TRADING_DAYS_PER_MONTH)),
    short: returns < of * FULL_WINDOW_SHARE,
  };
}

// Annualised Sharpe ratio: the mean daily return above the risk-free return,
// divided by the standard deviation of that excess return, times √252. Null
// with too few returns or none of them varying.
export function sharpeRatio(prices, riskFree) {
  const excess = excessReturns(prices, riskFree);
  if (excess.length < MIN_RETURNS) return null;
  const mean = excess.reduce((sum, r) => sum + r, 0) / excess.length;
  const variance = excess.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (excess.length - 1);
  if (variance === 0) return null;
  return (mean / Math.sqrt(variance)) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
