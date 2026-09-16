# Second Brain

A Personal AI Knowledge + Activity + Memory system. It quietly captures what you
read, watch, and work on across devices, then distills that raw activity into a
searchable, citable memory you can talk to.

> **Status: scaffold.** This repository currently contains the monorepo layout,
> configuration, type definitions, and placeholder implementations with `TODO`
> markers. Business logic is intentionally not implemented yet. See
> [docs/TASKS.md](docs/TASKS.md) for the build order.

## What it does

| Pillar              | Description                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Capture**         | A Chrome extension and an Android watcher collect page reads, text selections, YouTube watches, and foreground app sessions.                                                     |
| **Capture (cont.)** | Everything is scored locally first, deduplicated by content hash, queued offline, and synced in batches.                                                                         |
| **Process**         | An ingestion service validates and persists raw events; a processing service extracts readable content, chunks it, classifies topics, and distills chunks into durable memories. |
| **Recall**          | A retrieval service fuses vector search, full-text search, and metadata filters, reranks the result set, and assembles a cited context window for the LLM.                       |
| **Reflect**         | A web app provides chat-with-citations, an activity dashboard, and provider/rule/device settings.                                                                                |

## Architecture at a glance

```
┌──────────────────────┐   ┌──────────────────────┐
│  Chrome Extension    │   │  Android App         │
│  MV3 service worker  │   │  WorkManager + Room  │
│  IndexedDB queue     │   │  SQLite queue        │
└──────────┬───────────┘   └──────────┬───────────┘
           │        batched events    │
           └────────────┬─────────────┘
                        ▼
              ┌───────────────────┐
              │  Supabase         │  Postgres + pgvector + Auth + Storage
              │  (edge functions) │  RLS enforced per user
              └─────────┬─────────┘
                        ▼
     ┌──────────────────┴───────────────────┐
     │  services/ingestion  → validate      │
     │  services/processing → distill       │
     │  services/retrieval  → hybrid search │
     └──────────────────┬───────────────────┘
                        ▼
              ┌───────────────────┐
              │  apps/web (Next)  │  chat + dashboard + settings
              └───────────────────┘
```

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
apps/
  chrome-extension/   Manifest V3 extension — capture from the browser
  android/            Kotlin app — capture foreground app usage (Gradle, not npm)
  web/                Next.js dashboard, chat, and settings
services/
  ingestion/          Event intake: validation, dedup, persistence
  processing/         Importance scoring, extraction, chunking, distillation
  retrieval/          Hybrid search, intent routing, reranking, context assembly
packages/
  providers/          Embedding + LLM provider adapters behind one interface
  shared/             Cross-cutting types, constants, and pure utilities
  database/           Typed Supabase client and query modules
supabase/             Migrations, edge functions, seed data, CLI config
docs/                 Architecture, decisions, schema, roadmap
scripts/              Setup, dev orchestration, deploy
```

## Getting started

```bash
# Prerequisites: Node >= 20.11, pnpm >= 9, Docker (for the local Supabase stack)
pnpm install
cp .env.example .env          # then fill in the provider keys you intend to use
pnpm db:start                 # boot the local Supabase stack

pnpm build                    # build every workspace through Turborepo
pnpm dev                      # run web + services in watch mode
pnpm typecheck && pnpm lint   # the same gates CI runs
```

Or let the helper scripts do the checks for you:

```bash
bash scripts/setup.sh                 # verify toolchain, install, boot Supabase (idempotent)
bash scripts/dev.sh --only web        # start one target
bash scripts/deploy.sh staging --yes  # dry run by default; --yes is required to act
```

See [scripts/](scripts/) for what each one refuses to do without an explicit flag.

Platform-specific setup lives in each app's README
([extension](apps/chrome-extension/README.md), [web](apps/web/README.md),
[android](apps/android/README.md)).

## Conventions

- **Workspaces** are pnpm workspaces driven by Turborepo. Internal packages are
  consumed as `@second-brain/*` with the `workspace:*` protocol.
- **TypeScript** is strict everywhere via `tsconfig.base.json`. Each workspace
  extends it and turns `noEmit` off only where a real build step exists.
- **Secrets** never enter the client bundles. Only `SUPABASE_ANON_KEY` and its
  `VITE_` / `NEXT_PUBLIC_` twins are browser-safe, and only because Row Level
  Security is enforced underneath.
- **Privacy** is a feature, not a setting: the exclusion list, local scoring
  threshold, and "no body text for excluded apps" rule are documented in
  [docs/DECISIONS.md](docs/DECISIONS.md).

## Documentation

| Document                                        | Contents                             |
| ----------------------------------------------- | ------------------------------------ |
| [PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | Product intent, personas, scope      |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)         | Components, data flow, deployment    |
| [DECISIONS.md](docs/DECISIONS.md)               | ADR log with rationale               |
| [DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md)   | Tables, indexes, RLS policies        |
| [API_REFERENCE.md](docs/API_REFERENCE.md)       | Ingestion and retrieval HTTP surface |
| [RESEARCH_NOTES.md](docs/RESEARCH_NOTES.md)     | Provider/model benchmarks and spikes |
| [TASKS.md](docs/TASKS.md)                       | Phased implementation plan           |
| [ROADMAP.md](docs/ROADMAP.md)                   | Milestones beyond the current phase  |

## License

UNLICENSED — private project.
