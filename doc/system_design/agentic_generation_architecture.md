# Multi-Stage Agentic Generation Architecture

## Overview
This document outlines the architecture for the "Rise Path Agentic Generation Pipeline". Instead of a single monolithic prompt, we utilize a multi-stage, role-based approach to generate high-quality, personalized curriculums and personality insights. This ensures stability (avoiding token limits) and depth (better personalization).

## Core Philosophy
**"Divide and Conquer"**
By splitting the generation process into distinct phases, we allow the AI to focus on specific tasks (structure vs. content, psychology vs. career) without context overload.

---

## 🏗️ Course Generation Pipeline ("The Builder's Guild")

### 1. 🧠 The Strategist (Profile Analyzer)
*   **Input**: User's Big5 Profile, Topic.
*   **Role**: Analyzes the user's personality to determine the "Teacher Persona" and "Pedagogical Strategy".
*   **Output**: `PedagogicalManifest` (Persona definition, Tone guidelines, Reasoning).
*   **Model**: `gemini-2.5-flash` (Fast)

### 2. 🏗️ The Architect (Curriculum Designer)
*   **Input**: Topic, `PedagogicalManifest`.
*   **Role**: Designs the course skeleton. Determines the title, description, and the list of chapters (titles & objectives only).
*   **Output**: `CourseOutline` (Course metadata + Chapter list without slides).
*   **Model**: `gemini-2.5-flash` (Fast)

### 3. ✍️ The Creator (Content Writer)
*   **Input**: Chapter Title, Chapter Objective, `PedagogicalManifest`.
*   **Role**: Writes the detailed content for a *single* chapter, including slides, bullets, and the speech script.
*   **Execution**: Runs in **PARALLEL** for all chapters.
*   **Output**: `ChapterDetails` (Slides, Speech Script).
*   **Model**: `gemini-2.5-flash`

---

## 🔮 Personality Analysis Pipeline ("The Insight Council")

### 1. 🧠 The Profiler (Psychological Analyst)
*   **Input**: Big5 Scores.
*   **Role**: Determines the core archetype, cognitive strengths, and learning strategies.
*   **Output**: `personalityType`, `strengths`, `growthTips`, `learningStrategy`.
*   **System Prompt**: "You are an expert Psychometrician specializing in the Big Five model..."

### 2. 💼 The Career Coach (Professional Strategist)
*   **Input**: Big5 Scores, Core Archetype.
*   **Role**: Analyzes professional aptitude, team dynamics, and hidden talents.
*   **Output**: `careerCompatibility`, `businessPartnership`, `hiddenTalent`.
*   **System Prompt**: "You are an Executive Career Coach..."

### 3. 🤝 The Relationship Expert (Social Dynamics Specialist)
*   **Input**: Big5 Scores.
*   **Role**: Analyzes communication styles and interpersonal synergy.
*   **Output**: `relationshipAnalysis` (style, ideal partner, advice).
*   **System Prompt**: "You are a specialist in Interpersonal Dynamics and EQ..."

---

## Technical Implementation
*   **No Heavy Frameworks**: Pure TypeScript + `@google/genai` SDK.
*   **Strict Schemas**: Every stage uses `responseSchema` to guarantee JSON validity.
*   **Parallel Execution**: Use `Promise.all()` to generate all components simultaneously.
*   **Token Management**: By splitting responsibilities, we ensure no single response exceeds the token limit.