/** Number of decimal places implied by a step/tick like 0.001 → 3. */
function decimalsOf(step: number): number {
  if (Number.isInteger(step)) return 0;
  const str = step.toString();
  if (str.includes('e-')) {
    return Number(str.split('e-')[1]);
  }
  return str.split('.')[1]?.length ?? 0;
}

/** Floor `value` down to the lot `step` — never buy/sell more than intended. */
export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  const decimals = decimalsOf(step);
  const floored = Math.floor((value + Number.EPSILON) / step) * step;
  return Number(floored.toFixed(decimals));
}

/** Round `price` to the nearest `tick` on the price grid. */
export function roundToTick(price: number, tick: number): number {
  if (!(tick > 0)) return price;
  const decimals = decimalsOf(tick);
  const rounded = Math.round(price / tick) * tick;
  return Number(rounded.toFixed(decimals));
}
