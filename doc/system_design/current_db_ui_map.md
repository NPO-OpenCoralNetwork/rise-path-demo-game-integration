# Current DB and Curriculum UI Map

This document captures the current runtime structure and DB usage (as-is).
Source scan: `server/**`, `services/**`, `scripts/**`, and `doc/ai-curriculum-spec/local_postgres_phase1.sql`.

## Runtime structure (current)

```mermaid
flowchart LR
  subgraph UI
    CourseList["CourseList (generated list)"]
    CourseGenerator["CourseGeneratorView"]
    GeneratedCourse["GeneratedCourseViewWrapper"]
    GeneratedLesson["GeneratedLessonViewWrapper"]
    LearningHub["LearningHub"]
  end

  subgraph API
    ContentRoutes["/api/v2 (content routes)"]
    AiRoutes["/api/v2/ai (ai routes)"]
    LegacyPortals["/api/learning-portals (legacy)"]
  end

  subgraph Services
    LangGraph["LangGraph workflow"]
    JobWorker["jobWorker"]
    RagService["ragService"]
  end

  subgraph DB
    Users["auth.users"]
    Curricula["curricula"]
    Versions["curriculum_versions"]
    Sessions["ai_sessions"]
    Materials["materials"]
    Chunks["material_chunks"]
    Jobs["jobs"]
    Portals["learning_portals"]
  end

  CourseList -->|fetchGeneratedCourses| ContentRoutes
  GeneratedCourse -->|fetchGeneratedCourseById| ContentRoutes
  GeneratedLesson -->|fetchGeneratedCourseById| ContentRoutes
  CourseGenerator -->|sendAiChat/Decision| AiRoutes
  CourseGenerator -->|uploadFile| ContentRoutes
  LearningHub -->|fetchLearningPortals| LegacyPortals

  ContentRoutes --> Curricula
  ContentRoutes --> Versions
  ContentRoutes --> Materials
  ContentRoutes --> Jobs
  AiRoutes --> Sessions
  AiRoutes --> Curricula
  AiRoutes --> Versions
  AiRoutes --> LangGraph
  RagService --> Materials
  RagService --> Chunks
  JobWorker --> Jobs
  JobWorker --> Materials
  JobWorker --> RagService
  LegacyPortals --> Portals
  AiRoutes --> Users
  ContentRoutes --> Users
```

## Simplified layer view (TB)

```mermaid
flowchart TB
  %% Frontend
  subgraph FE[Frontend: React / Vite]
    UI[CourseGeneratorView / CourseList / GeneratedCourseViewWrapper]
    LearningHub[LearningHub]
    API_S[curriculumApi.ts]
    PortalAPI[learningPortalApi.ts]
    Adapter[vibeCodingAdapter.ts<br/>Template Mapping]
    UI --> API_S
    API_S --> Adapter
    LearningHub --> PortalAPI
  end

  %% Backend
  subgraph BE[Backend: Express / Node.js]
    AiRoute[/api/v2/ai/chat<br/>/api/v2/ai/curricula/:id/decision/]
    ContentRoute[/api/v2/curricula<br/>/api/v2/curricula/:id/]
    UploadRoute[/api/v2/upload/]
    RagRoute[/api/v2/rag/index<br/>/api/v2/jobs/:id/]
    LegacyPortals[/api/learning-portals/]
  end

  API_S --> AiRoute
  API_S --> ContentRoute
  API_S --> UploadRoute
  PortalAPI --> LegacyPortals

  %% LangGraph
  subgraph LG[Multi-Agent Workflow: LangGraph]
    Orchestrator{Orchestrator / Supervisor}
    Analyzer[Analyzer]
    Interviewer[Interviewer]
    Architect[Architect]
    Writer[Writer]
    Reviewer[Reviewer]
    Approval[Approval]
    Orchestrator --> Analyzer
    Orchestrator --> Interviewer
    Orchestrator --> Architect
    Orchestrator --> Writer
    Orchestrator --> Reviewer
    Orchestrator --> Approval
    Analyzer -. report .-> Orchestrator
    Reviewer -. report .-> Orchestrator
    Approval -. report .-> Orchestrator
  end

  %% AI Service
  subgraph AI[AI Service]
    Gemini[Gemini 2.0 Flash]
  end

  AiRoute --> Orchestrator
  Analyzer --> Gemini
  Interviewer --> Gemini
  Architect --> Gemini
  Writer --> Gemini
  Reviewer --> Gemini

  %% Services
  subgraph SV[Services]
    JobWorker[jobWorker]
    RagService[ragService]
  end

  UploadRoute --> RagService
  RagRoute --> JobWorker
  JobWorker --> RagService

  %% DB
  subgraph DB[PostgreSQL: phase1]
    Table_U[(auth.users)]
    Table_S[(ai_sessions)]
    Table_C[(curricula)]
    Table_V[(curriculum_versions)]
    Table_M[(materials)]
    Table_MC[(material_chunks)]
    Table_J[(jobs)]
    Table_P[(learning_portals)]
  end

  AiRoute --> Table_U
  AiRoute --> Table_S
  AiRoute --> Table_C
  AiRoute --> Table_V
  ContentRoute --> Table_C
  ContentRoute --> Table_V
  UploadRoute --> Table_M
  RagService --> Table_M
  RagService --> Table_MC
  RagRoute --> Table_J
  JobWorker --> Table_J
  LegacyPortals --> Table_P
```

## DB tables: active vs unused (current)

```mermaid
flowchart TB
  subgraph Active_Runtime
    T1["auth.users"]
    T2["curricula"]
    T3["curriculum_versions"]
    T4["ai_sessions"]
    T5["materials"]
    T6["material_chunks"]
    T7["jobs"]
    T8["learning_portals (read-only)"]
  end

  subgraph Not_Referenced
    U1["user_profiles"]
    U2["learning_portal_admins"]
    U3["ai_session_events"]
    U4["approvals"]
    U5["curriculum_progress"]
  end
```

### Active tables (runtime)
- `auth.users`: created by `ensurePhase1User` on demand.
- `curricula`, `curriculum_versions`: created/updated by AI flow and read by content API.
- `ai_sessions`: stores AI session state.
- `materials`, `material_chunks`: used by upload + ingestion + RAG retrieval.
- `jobs`: ingest queue for `jobWorker`.
- `learning_portals`: read via legacy `GET /api/learning-portals`.

### Not referenced in code (current scan)
- `user_profiles`
- `learning_portal_admins`
- `ai_session_events`
- `approvals`
- `curriculum_progress`

## Endpoint to DB mapping (current)
- `/api/v2/curricula` -> `curricula`
- `/api/v2/curricula/:id` -> `curricula` + `curriculum_versions`
- `/api/v2/ai/chat` -> `ai_sessions` + `curricula` + `curriculum_versions`
- `/api/v2/ai/curricula/:id/decision` -> `ai_sessions` + `curricula` + `curriculum_versions`
- `/api/v2/upload` -> `materials` (then `ragService` -> `material_chunks`)
- `/api/v2/rag/index` -> `jobs` (then `jobWorker` -> `materials`/`material_chunks`)
- `/api/v2/jobs/:id` -> `jobs`
- `/api/learning-portals` -> `learning_portals`

## Schema mismatches / drift (current)
- `curricula` columns used by code (`category`, `thumbnail`, `color`, `total_lessons`, `content`)
  are not in `local_postgres_phase1.sql`; they are added by `scripts/migrate_curricula.js`.
- `server/routes/content.js` tries a legacy fallback `SELECT content FROM curricula`,
  which depends on the `content` column added by the migration script.
- `curricula.visibility` and `curricula.ui_template_id` exist in SQL but are not read by API routes.
- `curriculum_versions.content_mix`, `assessment_mix`, `ui_hints`, `created_by` are not referenced
  in runtime code.

## UI boundary (current)
- UI uses `services/curriculumApi.ts` for `/api/v2/*`.
- UI uses `services/learningPortalApi.ts` for `/api/learning-portals` and PATCH endpoints,
  but the server currently only implements the GET endpoint.
