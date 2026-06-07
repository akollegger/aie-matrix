# IC-001: ParsedItemPlacement

**Package**: `@aie-matrix/map-gram`  
**Consumers**: `server/colyseus` (mapLoader), `server/world-api` (session init, Neo4j seeder)

## Contract

```typescript
interface ParsedItemPlacement {
  h3Index: string;
  itemRef: string;       // Pascal-case ItemType label (was: itemTypeName)
  layerIdentity: string;
  qty: number;           // defaults to 1 when omitted in gram source
}
```

## Gram syntax

```
(:Item:GoldCoin { geometry: [h3`8f2830828ffffff`] })           // qty defaults to 1
(:Item:GoldCoin { geometry: [h3`8f2830828ffffff`], qty: 10 })  // explicit qty
```

## Breaking changes from 026

- `itemTypeName` renamed to `itemRef`
- `qty` field added (non-breaking for consumers that default-handle absent fields)

## Downstream impact

| Consumer | Change required |
|---|---|
| `mapLoader.gram.ts` | Read `placement.itemRef`; expand `qty` into `initialItemRefs` |
| `server/world-api` session init | Sum `qty` per `(itemRef, h3Index)` to build `ItemSeed[]` |
| Neo4j seeder | Store `qty` as property on `HAS_ITEM` relationship |
