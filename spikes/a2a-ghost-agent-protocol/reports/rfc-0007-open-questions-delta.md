# RFC-0007 follow-ups suggested by spike 008

| RFC section / topic | One-line rationale |
|---------------------|--------------------|
| **Agent Card `matrix` object** | RFC now nests catalog metadata under `matrix` with `schemaVersion`; catalog should validate `matrix` shape or treat unknown keys as opaque per product policy. |
| **Catalog Service vs house REST** | Spike used ad-hoc `/v1/catalog/*` HTTP; RFC should name canonical paths or defer to implementation with “non-normative example”. |
| **Push / streaming prerequisites** | Document non-blocking task flow for push config registration before terminal task state. |
| **Contributor networking** | Note that localhost-only validation did not prove vendor NAT / TLS webhook viability. |
| **Authentication** | Spike ran `UserBuilder.noAuthentication`; RFC Open Questions should keep auth as explicit pre-production gate. |
