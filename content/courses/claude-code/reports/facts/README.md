# Fact records of the Claude Code course

What the lessons were checked against, kept for the monthly review (research report §8.4). Compare a new check
with these files to see what changed. Nothing here is shown to learners.

| File | What it is |
|---|---|
| `<lesson>.facts.md` | The verified facts a lesson was written from, with their official sources (research of 2026-10-20). |
| `<lesson>.audit.json` | The fact audit of the published text (2026-10-20). `checkedCount` is how many claims an auditor with web access checked against the official pages (`pagesFetched` lists them). Each finding then went to a second checker that tried to refute it: `confirmed` lists the findings it upheld, and each was fixed in the lesson (`fix`, `betterFix`); `dropped` lists the findings it refuted, whose text was kept (`verdict` holds the page and quote). A `laterChanged` note on a dropped finding records a later edit of that text for another reason. |
| `cross-lesson-facts.md` | Facts that several lessons state, and that every lesson and the report must state the same way. |

The research notes the facts came from are in `doc/brushup-2026/research/claude-code-factbase.md`.
The fetched copies of the official pages are not kept (they are the vendor's pages, not ours); `pagesFetched`
names them.
