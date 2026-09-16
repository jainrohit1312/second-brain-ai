# Second Brain — Project Overview

The product case for Second Brain: what problem it solves, who it is for, what it deliberately is not, and how we will know it works.

Status: draft — scaffold phase, no implementation yet. Every behavioural claim below is a target, not a measured result.

## The problem

Capturing information has been solved. Recalling it has not.

The average knowledge worker already has a capture pipeline: browser bookmarks, a "read later" queue, a notes app, a screenshots folder, a Slack DM to self, three open windows they are afraid to close. Capture is free and frictionless, so it happens constantly. Recall is expensive and manual, so it almost never happens. The result is what we call a write-only graveyard: an archive that grows monotonically, is searched roughly never, and answers no question anyone actually asks.

The failure is structural, not motivational. Four things break:

1. **Capture has no signal.** A bookmark records a URL and a timestamp. It does not record that you read the page for eleven minutes, that you copied a paragraph out of it, or that you came back to it three times across two devices. Without those signals, everything in the archive is equally important, which means nothing is.
2. **Storage is not memory.** Saving an article stores the article's text. It does not store anything about _you_ — what you concluded, what you decided, what you now believe that you did not believe before. When you ask "why did we pick Postgres over DynamoDB", a folder of engineering blog posts is not an answer.
3. **Search is lexical.** Full-text search matches tokens. The question a person actually has ("that piece I read a couple of weeks ago about why vector indexes get slow") shares almost no tokens with the document that answers it. Keyword search fails precisely when memory fails, which is exactly when you need it.
4. **Recall ignores time.** Human memory is temporal and associative: _when_ you saw something is as load-bearing as _what_ it said. A retrieval system that returns a flat ranked list of documents discards the dimension that makes the memory useful.

Second Brain is a bet that the missing product is not another capture tool but a **recall** tool: a system that observes what you read, watch, and work on, distills it into durable statements about you and your work, and answers questions with citations back to the original source.

## The five pillars

| Pillar      | What it means                                                                                                                                                      | Where it lives in this repo                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **Capture** | Passive observation of browsing, reading, watching, and foreground app usage on every device the user has authorised. No manual filing, no "save" button required. | `apps/chrome-extension`, `apps/android`     |
| **Process** | Raw activity becomes memories: extract readable content, chunk it, classify topics, score importance, and distill self-contained statements.                       | `services/processing`, `supabase/functions` |
| **Recall**  | Hybrid retrieval (vector + full-text + metadata), fused and reranked, assembled into a cited context window an LLM can answer from.                                | `services/retrieval`, `apps/web`            |
| **Reflect** | The user can see what was captured, correct it, curate topics, and ask questions — the system is inspectable, not a black box.                                     | `apps/web`                                  |
| **Privacy** | Local-first scoring, an exclusion list that records _nothing_ for excluded surfaces, no third-party training on user content, and honest data lifecycle controls.  | Everywhere; the invariant is stated below   |

The pillars are ordered by dependency, not by importance: Recall is the product, but it is worthless without Process, and Process has nothing to work on without Capture.

## Personas

### Mara — staff engineer, three machines

Mara reads RFCs and internal design docs on a work laptop, API references on a workstation, and Hacker News and release notes on a phone. She has a recurring, low-grade failure: she knows she read the definitive answer to a design question three weeks ago and cannot find it. She has four browsers' worth of open tabs she is afraid to close because closing them feels like losing the information.

**Scenario.** Mara is writing a design doc and needs to justify not using an event-sourcing approach. She asks Second Brain: "what did I read last month arguing against event sourcing for CRUD-shaped domains?" The system returns three ranked passages — one from a blog post read on her phone, one from an internal design doc read on the work laptop, one from a Hacker News discussion — each with the passage text, the source URL, the device it was captured on, and the date. She cites two of them. Total elapsed time: under a minute, versus the twenty she would have spent searching four history databases.

**Why this persona matters for design.** Cross-device deduplication and per-device attribution are not optional: the same URL read on three devices must not produce three equally-ranked memories, but the user must still be able to see _where_ a capture came from.

### Devi — researcher, forty papers a quarter

Devi is a graduate student in a literature-heavy field. She reads PDFs, arXiv listings, and journal sites. Her actual problem is not access, it is recall of _claims_: which paper asserted the effect size she now wants to characterise, and under what conditions. Reference managers store metadata; they do not store propositions.

**Scenario.** Devi asks: "which of the papers I read this quarter tested this on non-English data, and what did they find?" Second Brain has to filter by topic and date window, retrieve passages rather than whole PDFs, and answer with per-claim citations she can paste into a draft. The memories it has distilled — "Devi is working on cross-lingual evaluation" — shape retrieval by narrowing the candidate set before search runs.

**Why this persona matters for design.** Document-level granularity is insufficient. Retrieval must operate on chunks, citations must resolve to a specific passage, and the topic layer has to be accurate enough that metadata filters are useful rather than harmful.

### Tomas — consultant, four clients, no memory of last Tuesday

Tomas moves between client contexts. His work is spread across a browser, Slack, Figma, and an IDE. His recurring question is retrospective and activity-shaped, not document-shaped: "what did I actually do for this client last week?"

**Scenario.** Tomas asks: "summary of what I worked on for Northwind last Tuesday." No document answers this. The answer is assembled from `app_session`, `page_view`, and `page_read` events — time on a domain, apps opened, documents read — combined with distilled memories tagged to the Northwind project topic. He gets a short narrative with citations he can skim, and he can click through to the raw activity.

**Why this persona matters for design.** The `activity` query intent must be a first-class retrieval path, not a search abstraction over documents. Timestamps, durations, and app/domain identity are the primary signals here, and the system must be able to answer from event aggregates when no document is involved at all.

### The privacy persona is every persona

None of the three above would run a system that silently records their health portal, their banking tabs, and their private messages. The exclusion list is not a feature for a "privacy-conscious" segment; it is a precondition for any of the other three using the product at all. It is treated as such below.

## What "a memory" means here

This is the central product definition and the place where it is easiest to build the wrong thing. A memory is a **durable, self-contained statement about the user or their work**, not a summary of a document.

| Input                                 | Not a memory                                       | Is a memory                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A blog post about vector index tuning | "An article explaining HNSW vs IVFFlat tradeoffs." | "Mara is evaluating vector index options for a Postgres-backed retrieval service and is leaning toward HNSW for its incremental-write behaviour." |
| A meeting-notes page                  | A summary of the four agenda items.                | "The Northwind migration was deferred to Q1 because the client's legal review slipped."                                                           |
| A product documentation page          | "Docs for the Stripe webhook retry policy."        | "This project's webhook handler must be idempotent — retries are guaranteed for up to 72 hours."                                                  |

A document may legitimately produce **zero** memories. This is a rule, not an edge case (see [DECISIONS.md](./DECISIONS.md), ADR-007). A recipe page, a sports score, a login screenshot, a meme: the system is allowed — required — to conclude that nothing durable is worth extracting. Systems that force one summary per document produce an archive of summaries nobody reads, which is the failure mode we are trying to escape.

Three kinds of memory exist to keep the distinction sharp:

- **Durable state** (`fact`, `preference`, `decision`, `project`, `entity`) — things that remain true until contradicted.
- **Derived conclusions** (`insight`, `task`, `reference`) — things the user or system inferred, which may decay or complete.
- All of them carry temporal validity: they are true _from_ a date _to_ a date, and they are superseded rather than deleted (ADR-008). "What did I believe in March?" is a legitimate question.

## Non-goals

Stating these is not modesty; each one is a real product that people will ask us to become, and each would break a design property we depend on.

| Non-goal                                                           | Why not                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Not a note-taking app.**                                         | Users should not have to write anything for the system to be useful. If a feature only works because the user typed it in, it belongs in the user's existing notes app. Manual capture (`source: 'manual'`) exists so a user _can_ file something deliberately, not so they _must_. |
| **Not a bookmark manager.**                                        | A bookmark is a pointer with no signal. We store bookmarks as one input event among nine, but the product is not organised around URLs and folders, and we will not build folder hierarchies or bookmark import/sync.                                                               |
| **Not a team wiki or shared knowledge base.**                      | Every row is scoped to exactly one user by RLS with no sharing model. Collaboration would require an entirely different access model, a different privacy story, and a different schema. Team memory is a different product built on the same primitive.                            |
| **Not a screenshot or media archive.**                             | We capture _text-bearing_ content that can be chunked and cited. We do not do OCR, we do not store video, and we do not keep full page renders. A screenshot that never becomes text is storage cost with no recall value.                                                          |
| **Not a general-purpose RAG platform.**                            | One user's activity corpus, one retrieval pipeline, no arbitrary document upload for third parties, no API for other applications to build on.                                                                                                                                      |
| **Not an always-on screen recorder.**                              | The extension observes page-level events and the Android app reads usage statistics. Neither records keystrokes, form input, or screen contents. See the exclusion invariant.                                                                                                       |
| **Not a monitoring or surveillance tool for anyone but the user.** | There is no admin view, no manager dashboard, no per-employee reporting. A device is authorised by the user whose account it belongs to, and that user can revoke it.                                                                                                               |

## Success criteria

These are written to be falsifiable and to be checkable in the repo, not in a slide.

| #   | Criterion                                                                                                                                                                 | How it is checked                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | For a fixed held-out evaluation set of 50 recall questions with known correct sources, the correct source appears in the top 3 results for at least 80% of questions.     | A retrieval evaluation harness committed under the retrieval service; the question set and its expected sources are versioned alongside it. Gate for phase 4 exit.               |
| S2  | Every chat answer in the evaluation harness carries at least one citation that resolves to a row the user can open, and no citation references an id that does not exist. | Citation integrity assertion in the same harness; a failing citation fails the run.                                                                                              |
| S3  | An excluded app or domain produces **zero rows**, not a redacted row.                                                                                                     | An automated test that drives the capture path with an excluded domain/package and asserts the queue, the request body, and every destination table remain empty for that input. |
| S4  | An offline capture session of at least 24 hours and at least `SYNC_BATCH_SIZE` events syncs with no loss and no duplicates.                                               | Count captured events on the client, sync, then assert `count(distinct dedupe_key)` for that device equals the client-side count.                                                |
| S5  | Re-running the processing pipeline on the same document with the same version stamps is idempotent: no duplicate chunks, no duplicate memories.                           | Idempotency test that runs the pipeline twice and diffs row counts and content hashes.                                                                                           |
| S6  | Retrieval degrades rather than fails. With the embedding provider unreachable, a query still returns results, flagged `degraded: true`.                                   | Provider stubbed to fail in a test; assert a non-empty result set and the `degraded` flag.                                                                                       |
| S7  | The user can export everything the system holds about them and can hard-delete a document or memory such that it is unrecoverable by any application path.                | Export produces a manifest covering every table; hard delete is verified by asserting no row remains in any table reachable from the deleted id.                                 |
| S8  | Retrieval latency is measured on the local stack and recorded, and a p95 budget is set from that baseline in phase 4.                                                     | The number is not invented here; the criterion is that a measured number exists and is enforced as a gate.                                                                       |

Notably absent: engagement metrics, daily active users, retention curves. This is a personal tool; the success condition is that one person keeps using it because it answers questions, not that they open it daily.

## The privacy promise

Stated plainly, because a privacy policy written to be legally defensible is usually unreadable and therefore not a promise:

1. **Your content is not training data.** Nothing captured by Second Brain is used to train, fine-tune, or evaluate any model, ours or a provider's. Where a provider's API terms permit training on submitted data, that provider is not eligible to be the default (see [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)).
2. **Local scoring decides what leaves the device.** Every event is scored on the device first, and events below `IMPORTANCE_MIN_THRESHOLD` are dropped before they ever reach the sync queue. The device is a filter, not a firehose.
3. **Only the anon key ships to clients.** The extension and the Android app hold the Supabase anon key — which is useless without a user JWT and RLS — plus one per-device ingest secret. The service-role key exists only in server-side service environments.
4. **Exclusions record nothing at all.** This is the invariant, stated precisely:

   > **The exclusion invariant.** When a domain, an app package, or a URL pattern is on the device's exclusion list, the capture path produces no record of it whatsoever. No row in `activity_events`. No row in `documents`. No entry in the sync queue. No counter, no hash, no "suppressed" marker, no redacted placeholder. The event is not created, so it cannot be leaked, subpoenaed, or accidentally surfaced later. The exclusion check runs _before_ the event object is constructed, and the tests in S3 enforce it at the queue boundary.

   The single honest caveat: the exclusion _list_ itself is stored (it must be, to be enforced) and is visible to the user in settings. Exclusion entries are patterns the user typed, not observations about their activity.

5. **Two distinct retention regimes.** Raw activity events are short-lived and expire on a schedule; memories are durable and expire only when superseded or deleted by the user. The defaults are specified in [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) and are overridable per device.
6. **The user can see and correct everything.** Activity is browsable in the dashboard, topic assignments and memory statements are editable, and a wrong memory can be rejected. There is no hidden state: if the system inferred something, the inference, its confidence, its sources, and the prompt version that produced it are all inspectable.
7. **Deletion is real.** "Forget this" removes the row and its dependents. There is no tombstone that keeps the content, because a tombstone that retains the content is not a deletion — it is a promise about a column.

The honest limits, which the roadmap commits to stating to the user rather than burying: activity that has already been synced has already left the device and been sent to a provider for embedding and distillation; the exclusion list prevents capture, it does not retroactively un-send anything. This is why the exclusion list must be set up before capture starts, and why the onboarding flow asks for it first.

## Related documents

| Document                                   | Why you would read it                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](./ARCHITECTURE.md)       | How the pillars are actually built: components, data flow, failure modes, security model.                                     |
| [DECISIONS.md](./DECISIONS.md)             | The ADR log, including the reasoning behind the exclusion invariant (ADR-009, ADR-012) and memories-over-summaries (ADR-007). |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | The frozen data model every other document describes.                                                                         |
| [API_REFERENCE.md](./API_REFERENCE.md)     | The HTTP surface for capture and recall.                                                                                      |
| [RESEARCH_NOTES.md](./RESEARCH_NOTES.md)   | Provider candidates, what "a memory" should be, and the experiments that settle it.                                           |
| [TASKS.md](./TASKS.md)                     | The phased build order.                                                                                                       |
| [ROADMAP.md](./ROADMAP.md)                 | Milestones past v1, the risk register, and the commitments above made concrete.                                               |

Source paths referenced in this document live at [`apps/chrome-extension`](../apps/chrome-extension), [`apps/android`](../apps/android), [`apps/web`](../apps/web), [`services/processing`](../services/processing), [`services/retrieval`](../services/retrieval), and [`supabase`](../supabase).
