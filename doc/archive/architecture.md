# Architecture Diagram - Rise Path Learning Platform

## Personalized AI Learning Architecture

```mermaid
graph TD
    User[User] -->|Interacts| Frontend[React Frontend]

    subgraph "Frontend Application"
        App[App.tsx (Router)]
        
        subgraph "Features"
            Dashboard[Dashboard Feature]
            Generator[Course Generator UI]
            LessonView[Generated Lesson View]
            StaticModules[Static Modules (Art/Code/Blender)]
        end
        
        subgraph "Common"
            Layout[Layout & Navigation]
            UIComponents[Shared UI]
        end
    end

    subgraph "Backend Service (Node.js/Express)"
        APIServer[server.js]
        LangGraph[LangGraph Workflow]
        JobWorker[Async Job Worker]
        GeminiSvc[geminiBackendService.js]
        RAGSvc[ragService.js]
    end

    subgraph "Data & AI"
        DB[(PostgreSQL + pgvector)]
        GeminiAPI[Google Gemini API]
        ModelFlash[Gemini 2.0 Flash]
    end

    App --> Layout
    Layout --> Dashboard
    Layout --> StaticModules
    Layout --> Generator
    
    Generator -->|/api/v2/ai/chat| APIServer
    APIServer -->|Invoke| LangGraph
    LangGraph -->|Generate| GeminiSvc
    GeminiSvc -->|Retrieve Context| RAGSvc
    
    RAGSvc -->|Search| DB
    GeminiSvc -->|Prompt + Context| GeminiAPI
    GeminiAPI --> ModelFlash
    
    Generator -->|Upload Material| APIServer
    APIServer -->|Queue Job| DB
    JobWorker -->|Poll & Ingest| DB
    JobWorker -->|Embed| GeminiAPI
    
    GeminiAPI -->>|Structured JSON| GeminiSvc
    LangGraph -->>|State Sync| DB
    APIServer -->>|GeneratedCourse| App
    App -->|Render Data| LessonView
```

## Personalization Data Flow (Multi-Agent)

```mermaid
sequenceDiagram
    participant U as User
    participant UI as CourseGeneratorView
    participant API as API Server
    participant LG as LangGraph
    participant DB as PostgreSQL

    U->>UI: Input Topic: "Quantum Computing"
    UI->>API: POST /api/v2/ai/chat
    API->>LG: Invoke(State)
    
    note right of LG: Agent 1: Requirements
    LG->>LG: Generate Requirements Draft
    LG->>DB: Save Draft (Pending Approval)
    
    API-->>UI: Return "Approval Required"
    
    U->>UI: Click "Approve"
    UI->>API: POST /api/v2/curricula/:id/decision
    API->>LG: Invoke(State + Decision)
    
    note right of LG: Agent 2: Roadmap
    LG->>LG: Generate Roadmap
    
    note right of LG: Agent 3: Curriculum
    LG->>LG: Generate Full Content (vibe_coding)
    
    LG->>DB: Save Final Course
    API-->>UI: Return "Completed"
    UI->>U: Displays Personalized Curriculum
```
