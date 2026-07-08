// Formatters are constructed once: toLocaleString(locale, options) builds a
// fresh Intl.NumberFormat per call, which is the hot path at ~10 fps.
const priceFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const amountFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export const formatPrice = (value: number): string => priceFormat.format(value);

export const formatAmount = (value: number): string =>
  amountFormat.format(value);

/** Total = Price × Amount, rounded only here at the render boundary. */
export const formatTotal = (price: number, amount: number): string =>
  priceFormat.format(price * amount);
