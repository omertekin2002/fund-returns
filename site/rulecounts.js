// The rule cards' counts. A fund is counted once, under the first rule it
// breaks (fund.reason.rule), so the counts are first failures: they add up to
// the excluded funds, and a fund that also breaks a later rule is not counted
// there.

const countFormat = new Intl.NumberFormat("en-US");

// How many funds (classified with classifyFunds) each rule excludes first,
// keyed by rule id. Rules that exclude no fund are left out.
export function ruleCounts(funds) {
  const counts = {};
  for (const fund of funds) {
    if (fund.reason) counts[fund.reason.rule] = (counts[fund.reason.rule] ?? 0) + 1;
  }
  return counts;
}

// A card's count, e.g. "965 funds out here first." or "1 fund out here first.".
export function ruleCountText(n) {
  if (n === 0) return "No funds out here first.";
  return `${countFormat.format(n)} ${n === 1 ? "fund" : "funds"} out here first.`;
}

// The line under The Criteria heading, given how many funds are excluded.
export function ruleCountsNote(excluded) {
  const counted = "Each excluded fund is counted once, under the first rule it breaks";
  if (excluded === 0) return `${counted}. No fund is excluded in the latest data.`;
  const total = `${countFormat.format(excluded)} excluded ${excluded === 1 ? "fund" : "funds"}`;
  return `${counted}, so the cards add up to the ${total}.`;
}
