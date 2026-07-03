# Requirements Definition - Rise Path Learning Platform

## 1. Project Overview
**Project Name:** Rise Path Learning Platform
**Goal:** To provide a comprehensive, multi-disciplinary learning experience combining high-quality "Gold Standard" static curriculums with a dynamic, AI-powered "Pro" layer for personalized exploration. The platform democratizes access to education in Art, Technology, and Languages using cutting-edge Generative AI.

## 2. Target Audience
-   **Self-learners:** Individuals acquiring new skills in 3D modeling, programming, art history, etc.
-   **Students:** Supplementary learning for academic subjects.
-   **Creative Professionals:** Artists/Designers expanding technical skills.

## 3. Core Features

### 3.1 Learning Curriculums (The "Gold Standard")
The platform offers curated, structured paths:
*   **Art Museum:** Art History, Japanese Crafts (Kintsugi, Urushi), Tribal Art.
*   **Blender:** 3D modeling curriculum.
*   **Programming:** Web (HTML/CSS), AI & Python.
*   **Sonic Lab:** Creative coding with sound.
*   **Vibe:** Narrative-driven coding adventure.

### 3.2 Dynamic AI Learning (The "Pro" Layer)
*   **Model Selection:** Users can toggle between **Standard** (e.g., Gemini 2.0 Flash) and **Pro** (e.g., Gemini 3.0 Pro) models.
*   **Big5 Personalization:**
    *   **User Profiling:** Users can set their Big5 personality traits (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism) via sliders or presets.
    *   **Adaptive Content Generation:** The AI customizes the tone, structure, and focus of the curriculum based on the user's profile (e.g., more abstract/metaphorical for high Openness, more structured/step-by-step for high Conscientiousness).
*   **Rich Content Generation:**
    *   **Why It Matters:** Motivation aligned with user values.
    *   **Key Concepts:** Core keywords for retention.
    *   **Action Steps:** Concrete, immediate exercises.
    *   **Analogies:** Metaphors to explain complex ideas.
*   **RAG Integration (Planned/Simulated):**
    *   Retrieves context from existing static curriculums to ground AI responses.

### 3.3 User Experience & Management
*   **Dashboard:** Central hub showing progress, recent courses, and quick actions.
*   **Profile Passport:** User profile management.
*   **My Content:** Library of generated and saved courses.
*   **Course Generator:** Interactive UI for topic input and personalization settings.

### 3.4 Authentication & Security
*   **Login:** State-based flow (Mocked).
*   **Future Backend:** Adachi Service.

## 4. Functional Requirements

### 4.1 Frontend
*   **SPA Architecture:** React 19 + TypeScript.
*   **Feature-Based Directory Structure:** Organized by domain (`features/ai`, `features/art`, `features/dashboard`, etc.) for maintainability.
*   **State-Based Routing:** Custom `ViewState` controller.
*   **Dynamic UI:** Components adapt to display rich, structured AI content.

### 4.2 Backend / Services
*   **Gemini Service:**
    *   **Pedagogical Strategy Engine:** Generates dynamic system prompts based on user profiles.
    *   **Structured Output:** Returns strictly typed JSON for reliable UI rendering.
    *   **Mock Vector Store:** Simulates RAG by retrieving relevant keywords/content.

## 5. Non-Functional Requirements
*   **Reliability:** AI generation uses structured schemas to minimize formatting errors.
*   **Performance:** Optimized component rendering; Standard model option for speed.
*   **Scalability:** Modular "Feature-based" folder structure allows easy addition of new modules.
*   **Localization:** Primary support for Japanese (AI generation output is explicitly Japanese).

## 6. Constraints
*   **Current State:** No active persistent DB. Vector search is simulated.
