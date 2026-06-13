# IC-001: `behaviorKind` gram property

**Contract**: The `behaviorKind` string property on a `Character` gram node controls which behavior handler runs for that character's ghost loop.

**Valid values**: `"rule-engine"` | `"funder"`  
**Default when absent**: `"rule-engine"`

**Gram format**:
```gram
(char:Character { ..., behaviorKind: "funder" })
```

**Parser behavior** (`parse-character-gram.ts`): Reads `strProp(charProps, "behaviorKind")`; validates against the closed set above; defaults to `"rule-engine"` if absent. Returns a `CharacterParseError` if an unrecognized value is provided.

**Consumers**: `ghostActionLoop` in `executor.ts` reads `characterDef.behaviorKind` at tick dispatch time.
