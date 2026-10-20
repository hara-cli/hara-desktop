// Every owned cleanup is attempted and recorded even when another step fails.
export async function finishOwnedFixtureCleanup(steps, write) {
  const outcomes = [], failures = [];
  for (const { name, run } of steps) {
    let receipt;
    try { receipt = { ...await run(), completed: true }; }
    catch { receipt = { completed: false }; failures.push(name); }
    outcomes.push({ name, completed: receipt.completed });
    try { write(`${name}.json`, receipt); }
    catch { failures.push(`${name}:receipt`); }
  }
  const summary = { completed: failures.length === 0, steps: outcomes, failedStages: [...failures] };
  try { write("fixture-cleanup.json", summary); }
  catch { failures.push("fixture-cleanup:receipt"); }
  if (failures.length) throw new AggregateError(failures.map(name => new Error(name)), "Owned fixture cleanup incomplete; inspect individual receipts");
  return summary;
}
