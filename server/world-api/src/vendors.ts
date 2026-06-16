/**
 * Vendor (dispenser) registry — RFC-0029.
 *
 * A vending machine is a ledger ACTOR with a bag (its stock of food
 * item-resources) sitting on a cell, plus a price list (gold per item).
 * It is a SCRIPTED fixture: it does not run an agent loop. Instead, when a
 * ghost `request`s an item from it (offering gold), the request handler
 * checks this registry and — if the offer covers the price — auto-agrees
 * on the vendor's behalf, committing the trade through the existing
 * ProposalService/ledger. No new transaction machinery: purchase is just
 * `request` + an auto-`agree`.
 *
 * Deliberately a small module singleton rather than an Effect service:
 * it's read in one place (the request handler) and seeded once at startup,
 * so a Layer would be pure ceremony. Folds into the actor/ledger model
 * proper in Wave 2.
 */

export interface VendorInfo {
  readonly vendorId: string;
  /** Cell the machine sits on; a buyer must be co-located. */
  readonly cell: string;
  readonly label: string;
  /** Price in gold per one unit, keyed by item-resource id. */
  readonly prices: Readonly<Record<string, number>>;
}

const vendors = new Map<string, VendorInfo>();

export function registerVendor(info: VendorInfo): void {
  vendors.set(info.vendorId, info);
}

export function getVendor(vendorId: string): VendorInfo | undefined {
  return vendors.get(vendorId);
}

export function isVendor(actorId: string): boolean {
  return vendors.has(actorId);
}

export function listVendors(): VendorInfo[] {
  return [...vendors.values()];
}

/** Vendors on a given cell — for a co-located ghost's perception. */
export function vendorsOnCell(cell: string): VendorInfo[] {
  return [...vendors.values()].filter((v) => v.cell === cell);
}

/**
 * The first vending machine reachable from any of `cells` (the buyer's own
 * cell, then its neighbours). Lets a ghost buy from a machine it's standing
 * at or next to WITHOUT having to name the machine's opaque id — it just
 * needs to be there. The buyer's own cell should be `cells[0]` so it wins
 * ties.
 */
export function findReachableVendor(cells: readonly string[]): VendorInfo | undefined {
  for (const c of cells) {
    const v = vendorsOnCell(c)[0];
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Which item on a vendor's menu satisfies `wantResource`. A specific stocked
 * id (e.g. `food-cake`) is honoured exactly; a generic or unstocked food ask
 * (`food`, `food-burger`) falls back to the cheapest item on the menu so a
 * hungry ghost that just asks for "food" still gets fed. Non-food asks return
 * undefined (the machine only sells food).
 */
export function resolveVendorItem(vendor: VendorInfo, wantResource: string): string | undefined {
  if (vendor.prices[wantResource] !== undefined) return wantResource;
  if (wantResource === "food" || wantResource.startsWith("food")) {
    const cheapest = Object.entries(vendor.prices).sort((a, b) => a[1] - b[1])[0];
    return cheapest?.[0];
  }
  return undefined;
}

/**
 * Will this vendor accept the trade? True iff it stocks `wantResource` and
 * the gold offered covers its price for the requested quantity. (Whether
 * the vendor actually HOLDS the stock and the buyer can AFFORD it is
 * enforced by the ledger commit on agree — this is just the price gate.)
 */
export function vendorAcceptsOffer(
  vendor: VendorInfo,
  wantResource: string,
  wantQty: number,
  offeringResource: string,
  offeringQty: number,
): boolean {
  if (offeringResource !== "gold") return false;
  const unit = vendor.prices[wantResource];
  if (unit === undefined) return false;
  return offeringQty >= unit * wantQty;
}

/** Test-only reset. */
export function _clearVendors(): void {
  vendors.clear();
}
