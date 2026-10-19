<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

> **Rise Path note — no model key in the browser.**
> This folder is a standalone AI Studio prototype; it is not built or served by Rise Path.
> The main app only reuses `components/LoadingScreen.tsx`, `components/ResultScreen.tsx` and `types.ts`
> (from the repo-root `components/features/dashboard/assessment/PersonalAssessmentView.tsx`), and the diagnosis there
> comes from the server gateway (`POST /api/v2/llm/personality-insight` via the repo-root `services/llmApi.ts`).
>
> `vite.config.ts` no longer injects `GEMINI_API_KEY` (anything in `define` is shipped to every visitor).
> `services/geminiService.ts` therefore has no key and fails by design. To make this prototype work again,
> replace its `@google/genai` call with a `fetch` to the Rise Path server's `/api/v2/llm/*` routes
> (add a gateway task in `server/llm` if none fits) — never put the key back into the client bundle.

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1AKOJWWNuZmkREQ4Grv73W5zH2Qwh5nJx

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Point model calls at a running Rise Path server (`/api/v2/llm`); see the note above. Do not put a model key in `.env.local`.
3. Run the app:
   `npm run dev`
