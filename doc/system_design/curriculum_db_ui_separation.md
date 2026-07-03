# Curriculum DB/UI Separation

## Scope
This document defines the boundary between DB schemas and the curriculum UI in this repo.

## Responsibility map
- Backend DB + routes: `server/db.js`, `server/routes/ai.js`, `server/routes/content.js`
- API client + DTO normalization: `services/curriculumApi.ts`
- Template adapters: `services/vibeCodingAdapter.ts`
- UI rendering: `components/features/**`, `components/wrappers/**`
- Static fixtures: `data/curricula/**`, `services/curriculumData.ts`

## Data contracts (target)

### GET `/api/v2/curricula`
Response:
```json
{
  "ok": true,
  "curricula": [
    {
      "id": "uuid",
      "title": "string",
      "description": "string",
      "category": "string",
      "thumbnail": "string",
      "color": "string",
      "total_lessons": 0,
      "created_at": "timestamp"
    }
  ]
}
```
Notes:
- List responses are metadata only. No `content_json`, `modules`, or `chapters`.
- Progress and counts are derived in UI or via separate endpoints.

### GET `/api/v2/curricula/:id`
Response:
```json
{
  "ok": true,
  "curriculum": {
    "id": "uuid",
    "title": "string",
    "description": "string",
    "category": "string",
    "thumbnail": "string",
    "color": "string",
    "created_at": "timestamp"
  },
  "content": {
    "ui_template_id": "vibe_coding",
    "modules": []
  }
}
```
Notes:
- `content` is template JSON only and must include `ui_template_id`.
- `curriculum` is metadata only. DB fields like `current_version_id` are not exposed.

## Client normalization
- `services/curriculumApi.ts` is the only place that touches legacy payloads
  (`course`, `content_json`, or flat DB rows).
- It maps `ui_template_id` to adapters and returns UI domain types only:
  `Course` (list) and `GeneratedCourse` (detail).
- React components must not reach into DB-specific fields or raw payloads.

## Template adapters
- `services/vibeCodingAdapter.ts` maps `ui_template_id: "vibe_coding"` to
  `GeneratedCourse`.
- New templates should be added as adapters and expose:
  - `isTemplate(payload)`
  - `toGeneratedCourse(payload, options)`

## UI boundary rules
- UI-specific fields (e.g., `preferredTemplate`, `progress`) are derived in UI
  or adapters, never stored in DB payloads.
- Components only consume `Course` and `GeneratedCourse`, not raw API JSON.

## Non-goals
- No DB schema changes.
- No UI redesign.
- No endpoint behavior changes yet (this document is the target contract).
