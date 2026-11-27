import { z } from "zod";

/**
 * Monthly charges a plan change can introduce, and the confirmation the API
 * asks for before it applies them.
 *
 * A Cloud VPS plan change whose recurring Windows licence charge changes, or
 * that records extra IPv4 addresses which were not charged so far, is applied
 * only when the confirmation request carries the exact amounts the preview
 * returned (`acceptedWindowsLicense`, `acceptedIpv4`). Otherwise the API answers
 * HTTP 409 (`windowsLicenseQuoteChanged` or `ipv4QuoteChanged`) and changes
 * nothing. The API compares the whole object, so the shapes below are exact:
 * no extra keys, and the amounts are integer euro cents before VAT.
 */

const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const windowsLicenseShape = z
  .object({
    currentMonthlyCents: cents
      .nullable()
      .optional()
      .describe("Booked Windows licence charge per month, euro cents before VAT. Null (or left out) when only the combined amounts are known."),
    newMonthlyCents: cents
      .nullable()
      .optional()
      .describe("Windows licence charge per month on the new plan, euro cents before VAT. Null (or left out) when only the combined amounts are known."),
    currentCombinedMonthlyCents: cents
      .optional()
      .describe("Only when calculate_plan_change returned it: current combined monthly charge of Windows and other recurring extras, euro cents before VAT."),
    newCombinedMonthlyCents: cents
      .optional()
      .describe("Only when calculate_plan_change returned it: combined monthly charge on the new plan, euro cents before VAT."),
  })
  .strict();

type WindowsLicenseInput = z.infer<typeof windowsLicenseShape>;

export const acceptedWindowsLicenseSchema = windowsLicenseShape
  .refine(
    (value) => {
      const hasCombined = value.currentCombinedMonthlyCents !== undefined || value.newCombinedMonthlyCents !== undefined;
      if (hasCombined) {
        return value.currentCombinedMonthlyCents !== undefined
          && value.newCombinedMonthlyCents !== undefined
          && (value.currentMonthlyCents ?? null) === null
          && (value.newMonthlyCents ?? null) === null;
      }

      return typeof value.currentMonthlyCents === "number" && typeof value.newMonthlyCents === "number";
    },
    {
      message:
        "Pass the windowsLicense object exactly as calculate_plan_change returned it: either currentMonthlyCents and newMonthlyCents, "
        + "or (when those are null) currentCombinedMonthlyCents and newCombinedMonthlyCents.",
    }
  )
  .describe(
    "The windowsLicense object returned by calculate_plan_change, unchanged, after the user has seen and agreed to the new monthly Windows charge. "
    + "Shape: {currentMonthlyCents, newMonthlyCents} in euro cents before VAT; when the licence amount is not recorded, "
    + "{currentCombinedMonthlyCents, newCombinedMonthlyCents} instead. Never fill it in yourself and never pass it without the user's agreement."
  );

export const acceptedIpv4Schema = z
  .object({
    quantity: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER).describe("Total attached IPv4 addresses, including the plan's primary address."),
    currentMonthlyCents: cents
      .nullable()
      .optional()
      .describe("Current IPv4 renewal charge per month, euro cents before VAT; null (or left out) when the extra addresses had no price on record."),
    newMonthlyCents: cents.describe("IPv4 renewal charge per month after the change, euro cents before VAT."),
    renewalPriceVersion: z.string().min(1).max(255).describe("Tariff version the amounts were calculated at."),
  })
  .strict()
  .describe(
    "The ipv4 object returned by calculate_plan_change, unchanged, after the user has seen and agreed to the new monthly IPv4 charge. "
    + "Pass it only when calculate_plan_change says the IPv4 charge needs acceptance (quote_acceptance.ipv4.requires_acceptance true). "
    + "Never fill it in yourself and never pass it without the user's agreement."
  );

/** The IPv4 object in the exact form the API compares: a left-out current amount is the null it stands for. */
export function ipv4ForConfirm(value: z.infer<typeof acceptedIpv4Schema>): Record<string, number | string | null> {
  return {
    quantity: value.quantity,
    currentMonthlyCents: value.currentMonthlyCents ?? null,
    newMonthlyCents: value.newMonthlyCents,
    renewalPriceVersion: value.renewalPriceVersion,
  };
}

export type AcceptedWindowsLicense = z.infer<typeof acceptedWindowsLicenseSchema>;
export type AcceptedIpv4 = z.infer<typeof acceptedIpv4Schema>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isCents = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const euro = (value: number): string => `${(value / 100).toFixed(2)} EUR`;

/**
 * The Windows object in the exact form the API compares: the combined variant
 * always carries both licence amounts, as null.
 */
export function windowsLicenseForConfirm(value: WindowsLicenseInput): Record<string, number | null> {
  if (value.currentCombinedMonthlyCents !== undefined || value.newCombinedMonthlyCents !== undefined) {
    return {
      currentMonthlyCents: null,
      newMonthlyCents: null,
      currentCombinedMonthlyCents: value.currentCombinedMonthlyCents ?? null,
      newCombinedMonthlyCents: value.newCombinedMonthlyCents ?? null,
    };
  }

  return { currentMonthlyCents: value.currentMonthlyCents ?? null, newMonthlyCents: value.newMonthlyCents ?? null };
}

type WindowsQuote = {
  exact: Record<string, number | null>;
  summary: string;
  changes: boolean;
};

function readWindowsQuote(value: unknown): WindowsQuote | null {
  if (!isRecord(value)) return null;
  if (isCents(value.currentMonthlyCents) && isCents(value.newMonthlyCents)) {
    return {
      exact: { currentMonthlyCents: value.currentMonthlyCents, newMonthlyCents: value.newMonthlyCents },
      summary: `Windows licence: ${euro(value.currentMonthlyCents)} per month now, ${euro(value.newMonthlyCents)} per month after the change (before VAT).`,
      changes: value.currentMonthlyCents !== value.newMonthlyCents,
    };
  }

  if (isCents(value.currentCombinedMonthlyCents) && isCents(value.newCombinedMonthlyCents)) {
    return {
      exact: {
        currentMonthlyCents: null,
        newMonthlyCents: null,
        currentCombinedMonthlyCents: value.currentCombinedMonthlyCents,
        newCombinedMonthlyCents: value.newCombinedMonthlyCents,
      },
      summary:
        `Windows licence together with the other recurring extras of this server (the licence amount alone is not recorded): ${euro(value.currentCombinedMonthlyCents)} per month now, `
        + `${euro(value.newCombinedMonthlyCents)} per month after the change (before VAT).`,
      changes: value.currentCombinedMonthlyCents !== value.newCombinedMonthlyCents,
    };
  }

  return null;
}

type Ipv4Quote = {
  exact: Record<string, number | string | null>;
  summary: string;
  needsAcceptance: boolean;
};

function readIpv4Quote(value: unknown): Ipv4Quote | null {
  if (!isRecord(value)) return null;
  const { quantity, currentMonthlyCents, newMonthlyCents, renewalPriceVersion } = value;
  if (!isCents(quantity) || !isCents(newMonthlyCents) || typeof renewalPriceVersion !== "string"
      || (currentMonthlyCents !== null && !isCents(currentMonthlyCents))) {
    return null;
  }

  const before = currentMonthlyCents === null
    ? "no IPv4 charge on record so far"
    : `${euro(currentMonthlyCents)} per month now`;
  return {
    exact: { quantity, currentMonthlyCents, newMonthlyCents, renewalPriceVersion },
    summary: `IPv4 addresses (${quantity} attached in total): ${before}, ${euro(newMonthlyCents)} per month after the change (before VAT).`,
    // The API's own rule: no earlier IPv4 price on record and a new price above zero.
    needsAcceptance: currentMonthlyCents === null && newMonthlyCents > 0,
  };
}

/**
 * calculate_plan_change: keep the API answer as it is and add the quote parts
 * in words and in the exact shape change_plan must send back.
 */
export function withQuoteAcceptance(data: unknown): unknown {
  if (!isRecord(data)) return data;
  const windows = readWindowsQuote(data.windowsLicense);
  const ipv4 = readIpv4Quote(data.ipv4);
  if (windows === null && ipv4 === null) return data;

  const review: Record<string, unknown> = {};
  const required: string[] = [];
  if (windows !== null) {
    review.windowsLicense = {
      summary: windows.summary,
      requires_acceptance: windows.changes,
      ...(windows.changes ? { pass_to_change_plan_as: { acceptedWindowsLicense: windows.exact } } : {}),
    };
    if (windows.changes) required.push("acceptedWindowsLicense");
  }

  if (ipv4 !== null) {
    review.ipv4 = {
      summary: ipv4.summary,
      requires_acceptance: ipv4.needsAcceptance,
      ...(ipv4.needsAcceptance
        ? { pass_to_change_plan_as: { acceptedIpv4: ipv4.exact } }
        : { note: "No acceptance is needed for the IPv4 charge; do not send acceptedIpv4." }),
    };
    if (ipv4.needsAcceptance) required.push("acceptedIpv4");
  }

  review.acceptance_required = required.length > 0;
  review.next_step = required.length > 0
    ? `Tell the user the monthly charges above together with the new expiry and ask whether they agree. Only after they agree, call change_plan with the same orderNo, plan and resources and ${required.join(" and ")} exactly as shown (pass_to_change_plan_as). Do not agree to a price on the user's behalf.`
    : "These monthly charges need no acceptance; mention them to the user with the new expiry before change_plan.";

  return { ...data, quote_acceptance: review };
}

/**
 * change_plan: an HTTP 409 that only says the confirmed monthly charge is
 * missing or stale becomes a result that reads as "nothing happened, ask the
 * user", not as a failure. Any other answer is returned as null (unchanged).
 */
export function quoteChangedResult(
  status: number,
  data: unknown,
  sent: { acceptedWindowsLicense: boolean; acceptedIpv4: boolean }
): Record<string, unknown> | null {
  if (status !== 409 || !isRecord(data)) return null;
  const windowsChanged = data.windowsLicenseQuoteChanged === true;
  const ipv4Changed = data.ipv4QuoteChanged === true;
  if (!windowsChanged && !ipv4Changed) return null;

  const quotes: Record<string, unknown> = {};
  const lines: string[] = [];
  const accept: Record<string, unknown> = {};
  const staleOnly: string[] = [];

  if (windowsChanged) {
    const windows = readWindowsQuote(data.windowsLicense);
    if (windows !== null) {
      quotes.windowsLicense = data.windowsLicense;
      lines.push(windows.summary);
      accept.acceptedWindowsLicense = windows.exact;
    } else {
      staleOnly.push("windowsLicense");
    }
  }

  if (ipv4Changed) {
    const ipv4 = readIpv4Quote(data.ipv4);
    if (ipv4 !== null) {
      quotes.ipv4 = data.ipv4;
      lines.push(ipv4.summary);
      accept.acceptedIpv4 = ipv4.exact;
    } else {
      staleOnly.push("ipv4");
    }
  }

  const provided = (windowsChanged && sent.acceptedWindowsLicense) || (ipv4Changed && sent.acceptedIpv4);
  const reason = Object.keys(accept).length === 0
    ? "No confirmation is needed for this change; call change_plan again without it."
    : provided
      ? "The monthly charge you confirmed no longer matches the current quote."
      : "This plan change adds or changes a recurring monthly charge that must be confirmed first.";
  const result: Record<string, unknown> = {
    quote_changed: true,
    plan_changed: false,
    charged: false,
    message: `The plan was NOT changed and nothing was charged. ${reason}`,
    ...(windowsChanged ? { windowsLicenseQuoteChanged: true } : {}),
    ...(ipv4Changed ? { ipv4QuoteChanged: true } : {}),
    ...quotes,
    monthly_charges: lines,
  };

  if (Object.keys(accept).length > 0) {
    result.next_step =
      "Show the user the monthly charges above and ask whether they agree. Only after they agree, call change_plan again with the same orderNo, plan and resources and "
      + `${Object.keys(accept).join(" and ")} set to the values in accept_with. Do not agree to a price on the user's behalf and do not retry before the user has answered.`;
    result.accept_with = accept;
  }

  if (staleOnly.length > 0) {
    result.note =
      `The API returned no current ${staleOnly.join(" / ")} charge to confirm: no such confirmation is needed for this change. `
      + "Call change_plan again without it, or run calculate_plan_change again to see the current quote.";
  }

  return result;
}
