/**
 * A stateless item definition loaded from a `*.items.json` sidecar at startup.
 * The `itemRef` (sidecar key) does not appear inside the record.
 */
export interface ItemDefinition {
  /** Short display name returned by look and inspect. */
  name: string;
  /**
   * Ruleset label for PICK_UP / PUT_DOWN evaluation.
   * Colon-separated multi-label for compound taxonomy (e.g. "Key" or "Badge:Sponsor").
   * Each segment becomes a Neo4j node label.
   */
  itemClass: string;
  /** Whether take is permitted for this item. */
  carriable: boolean;
  /** Capacity units consumed on the host tile. 0 = no capacity impact. */
  capacityCost: number;
  /** Full text returned by inspect. Omitting means inspect returns name only. */
  description?: string;
  /**
   * Open-ended authoring attributes. Omit when empty.
   * Neo4j loader maps each key as `attr_<key>` on the ItemInstance node.
   */
  attrs?: Record<string, string | number>;
}

/** Keyed by itemRef. The itemRef does not appear inside the record. */
export type ItemSidecar = Record<string, ItemDefinition>;
