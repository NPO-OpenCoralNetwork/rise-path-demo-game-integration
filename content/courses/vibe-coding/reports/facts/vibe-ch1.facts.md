# Verified facts for vibe-ch1 (checked 2026-10-30)

What the draft `drafts/vibe-ch1.lesson.json` was written from: the repository first, then the official documentation.
Every outside page was read on 2026-10-30 (WebFetch). Each entry says, in our own words, what the page states and
which lesson blocks rely on it, so a reviewer can find the statement on the page (the place on the page is named).
The pages are not copied here; open the URL to read the wording. Nothing here is shown to learners.

## 1. This repository

- `data/curricula/vibe_coding/chapter1.ts` and `chapter1_quiz.ts` — the original chapter. Kept from it: the three
  parts with the restaurant analogy, UI vs API, deployment as build / transfer / launch, Git as a save point.
  Dropped: the claim that knowing frontend vs backend makes the generated code "dramatically" more accurate, and that
  Git is "the only way" to rewind (no source says either); the decorative Unsplash image; the definitions of push and
  revert (out of this chapter's objectives; push is taught in ch5).
- `content/courses/vibe-coding/lessons/vibe-ch1.lesson.json` (published) — every id is kept. Its q1 ("which part of
  the restaurant is the backend?") and q3 ("why is Git called a time machine?") quizzed the analogy; they are rewritten.
  Its practice section, worked example and exam question for o1 were missing; they are added.
- Neighbours: `vibe-ch0` (the human gives the vision and judges; the AI implements), `vibe-ch2` (planning; its brief
  records cc-best-practices as read on 2026-10-19), `vibe-ch5` (commit / push / clone in depth), `vibe-ch8` (deploy to
  hosting services). ch1 stays tool-neutral and leaves those details to them.
- `content/courses/claude-code/reports/facts/`: `cc-01-first-session.facts.md` [learning entry on the Quickstart order:
  Git by asking, then commit], `cc-02-permissions.facts.md` [docs-17, learning-26: checkpoints are not a replacement for
  git], `cc-03-plan-first.facts.md` [practice-8, learning-24: specific prompts; champion kit "only change X"]. Each was
  read again on the official page on 2026-10-30 (below); the best-practices page has changed wording since 10-19.
- `README.ja.md` — looked at for a real three-part example (React front end, Express server). Not used: it does not
  describe the database, and product names are out of scope for ch1.

## 2. Web platform (MDN)

### mdn-server-side — Introduction to the server side
https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/First_steps/Introduction
(page last modified 2026-09-12)
- Code in the browser (client side) mainly handles how the page looks and behaves: UI components, layout, navigation,
  form checks. Server-side code mainly decides what content goes back to the browser; it checks submitted data and
  requests, stores and retrieves data with databases, and sends the right data to the client. (section "Are
  server-side and client-side programming the same?"; the "Summary" section says the same.)
- Web servers wait for request messages from the client, handle them, and reply to the browser. (section "What is
  server-side website programming?", before "Static sites")
- Large sites usually pull data from a database on a server and send it to the client to display. (the introduction,
  above "In this article")
- Used in: `hook-predict` (explanation), `s1-b1`, `s1-b5` (frontend and backend definitions), `s1-b2`, `s1-b4`,
  `s1-check`, `s2-b5`, `s3-b2` (the server waits for requests), `ex-steps`, `q6` (checking a booking belongs to the
  server side).

### mdn-client-storage — Client-side storage
https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Client-side_APIs/Client-side_storage
(page last modified 2026-07-20)
- Without storing it, a value on the page does not persist across page reloads (the web storage example).
- Most sites store data on the server in some kind of database and retrieve it with server-side code; client-side
  storage keeps data on the user's own machine instead. (opening section)
- Used in: `hook-predict` (data that is not stored is gone after a reload), `s1-b4`, `ex-steps` (step ex-verify).
- Not used in the lesson: browser storage itself (localStorage, IndexedDB). The lesson says only that data the page
  merely holds is lost on reload, and that saving it for later is the server side's and the database's job; it does not
  say a backend is the only way to keep data.

### mdn-network-requests — Making network requests with JavaScript
https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Network_requests
(page last modified 2025-09-29)
- A page can request data from the server and update part of itself without loading a new page; the data is often
  JSON, a good format for structured data. (opening section)
- Used in: `s2-json-intro`, `s2-b2` (API and JSON definitions), `ex-steps` (the screen shows what the API returns).

### mdn-glossary-ui — UI (Glossary)
https://developer.mozilla.org/en-US/docs/Glossary/UI (last modified 2025-07-11)
- A user interface is whatever lets a user interact with a machine; for software, examples include a web page, an
  input form and the front end of an application.
- Used in: `s2-b2` (UI definition), `s2-analogy`.

### mdn-glossary-api — API (Glossary)
https://developer.mozilla.org/en-US/docs/Glossary/API (last modified 2025-07-11)
- An API is a set of features and rules inside a program that lets other software interact with it, in contrast to a
  user interface for humans; it can be seen as a contract between the program and what uses it.
- Used in: `s2-b2` (API definition: a window and rules for programs, unlike the UI for people), `s2-analogy`.

### mdn-glossary-json — JSON (Glossary)
https://developer.mozilla.org/en-US/docs/Glossary/JSON (last modified 2025-07-11)
- JSON (JavaScript Object Notation) is a format for exchanging data.
- Used in: `s2-b2` (JSON definition), `s2-analogy`. The name/value shape shown in `s2-b4` is the code itself.

### mdn-glossary-database — Database (Glossary)
https://developer.mozilla.org/en-US/docs/Glossary/Database (last modified 2025-12-15)
- A database is a storage system for organized data that makes it easier to search and structure.
- Used in: `s1-b5` (database definition), `card-database`.

### mdn-glossary-server — Server (Glossary)
https://developer.mozilla.org/en-US/docs/Glossary/Server (last modified 2025-07-11)
- A server is software or hardware that offers a service to a client.
- Used in: `s1-b5` (the gloss of サーバー inside the backend definition).

### mdn-publishing — Publishing your website
https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Your_first_website/Publishing_your_website
(page last modified 2026-09-12)
- After writing a site you put it online so people can find it. Hosting is space on a hosting company's web server: you
  put the files there and the server provides them to visitors. Companies offer several ways to transfer files to their
  servers, including fetching the source from a GitHub repository, building it if needed and publishing it.
- Used in: `s3-defs` (deploy definition), `s3-b2` (transfer), `q7`, `q4`.

### mdn-deployment — Deploying our app
https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Client-side_tools/Deployment
(page last modified 2026-09-04)
- A production build makes the files smaller and ready for production; the build output goes into a new folder
  (`dist`) that holds everything needed to run the site, ready to upload to a server. The hosting service then serves
  the site at a URL, live on the web.
- Used in: `s3-defs` (build definition), `s3-b2`, `q4` (after the build the files exist but are not on the server
  yet; the source code is not replaced).

### mdn-express-intro — Express/Node introduction
https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Server-side/Express_Nodejs/Introduction
(page last modified 2026-09-12)
- In the Hello World example, the last block starts the server on a port; with the server running, a browser can get
  its response. (section "Helloworld Express")
- Used in: `s3-b2` (launch: start the program on the server so it answers requests).

## 3. Git (Pro Git and the reference manual, Git 2.56)

The latest Git release on git-scm.com is 2.56.0 (2026-09-28). The git-commit page was last changed in 2.55.0 and lists
2.56.0 with no changes.

### git-about-vc — Pro Git 1.1 About Version Control
https://git-scm.com/book/en/v2/Getting-Started-About-Version-Control
- Version control records changes to files over time so that you can recall specific versions later; it lets you
  revert files or the whole project to a previous state and compare changes.
- Used in: `s4-b2` (Git definition), `s4-b4`, `card-commit`.

### git-what-is-git — Pro Git 1.3 What is Git?
https://git-scm.com/book/en/v2/Getting-Started-What-is-Git%3F
- Every time you commit (save the state of your project), Git takes a snapshot of what all your files look like at
  that moment. (section "Snapshots, Not Differences")
- Used in: `s4-b2` (commit definition), `s4-analogy` (one save = one commit).

### git-undoing — Pro Git 2.4 Undoing Things
https://git-scm.com/book/en/v2/Git-Basics-Undoing-Things
- Anything committed can almost always be recovered; anything lost that was never committed is likely gone for good.
  (section "Unmodifying a Modified File", the paragraph after the "Important" box.) Some undo commands can themselves
  lose work. (opening paragraph of "Undoing Things")
- Used in: `s4-b4`, `s4-check` (go back to the commit), `q3`.

### git-commit — git-commit (reference manual)
https://git-scm.com/docs/git-commit
- `git commit` records changes to the repository: it creates a new commit from the current contents of the index with
  a log message that describes the changes. (NAME and DESCRIPTION)
- Used in: `s4-b2` (a commit is recorded with a message), `s4-prompt-commit`, `ex-steps` (step ex-commit).

## 4. AI tool guidance (Claude Code documentation, read 2026-10-30)

The course does not depend on one AI tool. These pages are the official guidance of one such tool; the lesson uses
them for how to write a request (scope, order, commit first) and names Claude Code where a statement is about that
tool only (its rewind feature).

### cc-quickstart — Quickstart
https://code.claude.com/docs/en/quickstart
- Step 5 "Use Git with Claude Code": Git operations are done by asking, for example asking it to commit the changes
  with a descriptive message.
- "Pro tips for beginners", "Use step-by-step instructions": break a complex task into steps; the example is a
  database table first, then an API endpoint, then a web page that uses it.
- Used in: `s4-prompt-commit`, `ex-steps` (data side first, then the screen; commit by asking), `practice-answer-data`,
  `practice-answer-ui`.

### cc-best-practices — Best practices for Claude Code
https://code.claude.com/docs/en/best-practices
- "Write a specific prompt": naming the file, the symptom and what "fixed" looks like up front usually saves a round
  of corrections.
- The rewind menu rolls code and conversation back so you can try again; after failed corrections, a fresh start with
  one better prompt works better. Checkpoints work alongside git, not instead of it.
- Used in: `s2-b5` (state the scope), `s4-check` (go back, then change how you ask), `q5`.

### cc-champion-kit — Champion kit
https://code.claude.com/docs/en/champion-kit
- Quick-reference sheet, row "Keep edits surgical": ask for a diff, or say "only change X"; Claude keeps to the scope
  when the scope is stated.
- Used in: `s2-b5`, `s2-prompt-ui`, `s2-prompt-api`, `ex-steps` (steps ex-api, ex-ui), `q5`, `q9`.

### cc-checkpointing — Checkpointing
https://code.claude.com/docs/en/checkpointing
- Claude Code tracks its own file edits so you can undo changes and go back if something goes wrong; one listed use is
  recovering from changes that introduced bugs or broke functionality.
- "Not a replacement for version control": checkpoints are for quick recovery within a session; for permanent history,
  keep using version control such as Git.
- Used in: `s4-b1` (an AI's change can break something that worked), `s4-tools`, `q3`.

## 5. Claims checked and left out

- "Knowing frontend vs backend raises the accuracy of generated code a lot" (published `s1-b4`): no source. Replaced by
  the scope advice that `cc-best-practices` and `cc-champion-kit` support.
- "With Git, one command takes you back for sure" (published `s4-b4`): Pro Git says committed work can almost always
  be recovered, and that some undo commands can lose work. The draft says "almost always" and names no command.
- "Revert returns you to an earlier save point" (published `s4-b2`): `git revert` adds a new commit that reverses
  earlier ones (git-revert manual); it does not move back in history. The draft does not define revert.
- Example tool names (React, Vue.js, Node.js, Python, PostgreSQL, MySQL, Vercel, Render): left out of ch1; the MDN pages
  name some of them, but the objectives do not need them and later chapters introduce the tools they use.
