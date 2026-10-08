export type ManualUpiCheckout = {
  provider: "manual-upi";
  payeeName: string;
  upiId: string;
  amountInr: number;
  paymentUri: string;
};

/**
 * Checkout contract kept separate so a gateway can replace the UPI adapter later.
 * Sanitizes input and validates payment parameters.
 */
export function createManualUpiCheckout(
  eventName: string,
  amountInr: number,
): ManualUpiCheckout {
  const upiId = (process.env.NEXT_PUBLIC_UPI_ID || "").trim() || "khelaiya-desk@bank";
  const payeeName = (process.env.NEXT_PUBLIC_UPI_PAYEE || "").trim() || "Khelaiya Events";

  // Sanitize eventName for UPI transaction note
  const sanitizedEventName = eventName.replace(/[^\w\s-]/g, "").slice(0, 40);

  const query = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: String(Math.max(0, amountInr)),
    cu: "INR",
    tn: `Khelaiya - ${sanitizedEventName}`,
  });

  return {
    provider: "manual-upi",
    payeeName,
    upiId,
    amountInr,
    paymentUri: `upi://pay?${query.toString()}`,
  };
}
