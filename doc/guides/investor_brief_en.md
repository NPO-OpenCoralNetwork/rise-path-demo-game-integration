# Rise Path Investor Brief (EN)

## One-liner
An immersive, personalized learning platform that blends curated curricula with AI-generated courses.
Hybrid model: "Gold Standard" static paths + "Pro" AI personalization.

## Problem
- Traditional LMS is static and one-size-fits-all, leading to low retention
- Learners need personalization by goals and personality
- Community sites (kids cafeterias / third places) lack scalable, high-quality learning tools

## Solution
- Big5-based personalization to optimize tone, structure, and pace
- 3-step approval loop (Requirements -> Roadmap -> Curriculum) for quality and alignment
- RAG-backed generation with citations

## Product
- AI concierge scopes needs through chat
- Structured output stored as JSON
- Generated content renders immediately in the UI (vibe_coding template)

## Differentiation
- Multi-agent workflow (Interviewer / Architect / Writer / Reviewer)
- Structured outputs stabilize UI quality
- Multi-format learning (slides / dialogue / checklists / quizzes)

## Tech Snapshot
- Frontend: React 19 + Vite + TypeScript
- Backend: Node/Express + LangGraph
- Data: Postgres + pgvector (optional)
- AI: Google Gemini

## Pricing (USD / month)

### B2C
| Plan | Price | Generation/Chat | RAG Sources | Notes |
| --- | --- | --- | --- | --- |
| Free | $0 | 1 course/mo + light chat | 1 | Trial |
| Starter | $10 | 5 courses/mo + heavy | 10 | Private course generation |
| Creator | $20 | 15 courses/mo + very heavy | 30 | Public publishing + monetization + API/MCP (capped) |
| Max | $50 | near-unlimited | 100 | Almost unlimited + higher API/MCP cap |

### Community / Facility (B2B2C, per site)
| Plan | Price | Learners | Credits | Notes |
| --- | --- | --- | --- | --- |
| Community Free (Sponsored) | $0 | <= 20 | 50 | Free seat pool |
| Community Start | $49 | <= 80 | 400 | 3 staff accounts |
| Community Plus | $149 | <= 250 | 1500 | TTS / 10 staff |
| Network | $299 | <= 5 sites | 3000 | Admin reporting |

Add-on: $10 / 120 credits (generation + API/MCP usage)  
Revenue mix: subscription + credits + sponsored community seats

## Traction / Status
- MVP completed
- Pilot begins in February at two Osaka community sites
- LangGraph + RAG + DB sync + approval loop implemented
- Multi-domain ready (Blender / Unity / Art / Programming)

## 12-Month Roadmap (Targets)
- 0-3 months: Osaka 2-site pilot live, RAG ingestion ops
- 4-6 months: Multi-format production + TTS/voice sync
- 7-9 months: B2C billing + credits monetization live
- 10-12 months: Expand community sites + template library

## Ask
- EUR 1.0M Seed (18-24 months runway)
- Use of funds: 45% Product/AI, 35% GTM/Partnerships, 20% Infra/Ops

## Demo Flow (2-3 min)
1. Enter a topic or upload materials
2. Approve Requirements / Roadmap / Curriculum
3. Open generated course in Lesson View

## Inputs Needed (if available)
- Pilot KPIs (MAU / weekly usage / generation volume)
- Pricing validation (conversion rate)
- Partner count and growth targets
