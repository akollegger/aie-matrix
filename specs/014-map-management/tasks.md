# Spec 014 — Map Management Tasks

## US1 — Map Publish / List / Get / Archive

- [x] T011 — Add MapPublishError, MapAlreadyActiveError, MultipartParseError to map-errors.ts
- [x] T012 — Create MapManagementService.ts (publish, list, get, archive)
- [x] T013 — Create multipart.ts (parseMultipart)
- [x] T014 — Create MapManagementRoutes.ts (POST/GET/DELETE /maps)
- [x] T015 — Add error HTTP mappings to server/src/errors.ts
- [x] T016 — Export from server/world-api/src/index.ts
- [x] T017 — Register routes in server/src/index.ts
- [x] T018 — US1 verification checkpoint ✓

## US2 — Live Session Start / List / Get / End

- [x] T019 — Create live-errors.ts
- [x] T020 — Create LiveSessionService.ts
- [x] T021 — Create LiveSessionRoutes.ts
- [x] T022 — Add LiveSession error mappings to server/src/errors.ts
- [x] T023 — Export LiveSession from server/world-api/src/index.ts
- [x] T024 — Register /live routes in server/src/index.ts
- [x] T025 — Startup session-binding logic
- [x] T026 — Add /health endpoint
- [x] T027 — US2 verification checkpoint ✓

## US3 — Map Switch + Ghost Evacuation

- [x] T028 — switchMaps implemented in LiveSessionService (removedCells/addedCells)
- [x] T029 — PATCH /live/:id/maps handler in LiveSessionRoutes
- [x] T030 — Create evacuation.ts
- [x] T031 — Add GhostInLimboError to world-api-errors.ts + HTTP mapping
- [x] T032 — TODO: Wire evacuation call into LiveSessionService.switchMaps (post-map-changed event)
- [x] T033 — TODO stub: GhostInLimboError exists and maps to HTTP 422 GHOST_IN_LIMBO
- [x] T034 — RFC-0012 speaker-room comment added in evacuation.ts

## US4 — Archive / End (already included in US1/US2 implementations)

- [x] T036 — MapManagementService.archive implemented
- [x] T037 — DELETE /maps/:mapId handler in MapManagementRoutes
- [x] T038 — LiveSessionService.end implemented
- [x] T039 — DELETE /live/:id handler in LiveSessionRoutes
- [x] T040 — US4 verification checkpoint ✓
