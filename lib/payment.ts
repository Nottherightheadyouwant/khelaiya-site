export type ManualUpiCheckout = {
  provider: "manual-upi";
  payeeName: string;
  upiId: string;
  amountInr: number;
  paymentUri: string;
};

/** Checkout contract kept separate so a gateway can replace the UPI adapter later. */
export function createManualUpiCheckout(
  eventName: string,
  amountInr: number,
): ManualUpiCheckout {
  const upiId = process.env.NEXT_PUBLIC_UPI_ID || "your-business-upi@bank";
  const payeeName = process.env.NEXT_PUBLIC_UPI_PAYEE || "Khelaiya Events";
  const query = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: String(amountInr),
    cu: "INR",
    tn: `Khelaiya · ${eventName}`,
  });
  return {
    provider: "manual-upi",
    payeeName,
    upiId,
    amountInr,
    paymentUri: `upi://pay?${query.toString()}`,
  };
}
