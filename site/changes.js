// Which funds entered or left the passing list since the previous update.
// data/previous.json is the last earlier day's data/funds.json (kept by
// scripts/fetch_funds.py); both are classified with the same rules.
import { exclusionReason } from "./filter.js";
import { riskFreeReturns, sharpeRatio } from "./sharpe.js";

// Adds each fund's 4-week Sharpe ratio and its exclusion reason (null if it
// passes every rule) to the funds of a data file.
export function classifyFunds(funds) {
  const riskFree = riskFreeReturns(funds);
  return funds.map((raw) => {
    const fund = { ...raw, sharpe: sharpeRatio(raw.prices, riskFree) };
    return { ...fund, reason: exclusionReason(fund) };
  });
}

// Compares two classified fund lists. A fund entered if it passes now and
// didn't pass before (including funds new to the data); it left if it passed
// before and doesn't pass now (including funds gone from the data, which are
// also listed in "gone"). Each list holds sorted fund codes.
export function membershipChanges(current, previous) {
  const passingCodes = (funds) => new Set(funds.filter((f) => !f.reason).map((f) => f.code));
  const passesNow = passingCodes(current);
  const passedBefore = passingCodes(previous);
  const inData = new Set(current.map((f) => f.code));
  const sorted = (codes) => [...codes].sort((a, b) => a.localeCompare(b, "tr"));
  const entered = sorted([...passesNow].filter((code) => !passedBefore.has(code)));
  const left = sorted([...passedBefore].filter((code) => !passesNow.has(code)));
  return { entered, left, gone: left.filter((code) => !inData.has(code)) };
}

const countFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", dateStyle: "medium" });

const funds = (n) => `${countFormat.format(n)} ${n === 1 ? "fund" : "funds"}`;

// The one-line summary of the changes since the previous update fetched at
// previousFetchedAt (an ISO timestamp), e.g. "Since 27 Oct 2026: 3 funds
// entered, 2 left the passing list."
export function changesSummary({ entered, left, gone }, previousFetchedAt) {
  const date = new Date(previousFetchedAt);
  const since =
    typeof previousFetchedAt === "string" && !Number.isNaN(date.getTime())
      ? `Since ${dateFormat.format(date)}`
      : "Since the previous update";
  let text;
  if (entered.length === 0 && left.length === 0) {
    text = `${since}: no fund entered or left the passing list.`;
  } else if (left.length === 0) {
    text = `${since}: ${funds(entered.length)} entered the passing list.`;
  } else if (entered.length === 0) {
    text = `${since}: ${funds(left.length)} left the passing list.`;
  } else {
    text = `${since}: ${funds(entered.length)} entered, ${countFormat.format(left.length)} left the passing list.`;
  }
  if (gone.length > 0) text += ` No longer in the data: ${gone.join(", ")}.`;
  return text;
}
