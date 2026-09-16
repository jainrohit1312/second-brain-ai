-- ---------------------------------------------------------------------------
-- 20260916097000_add_statement_hash_to_memories.sql
--
-- Adds `second_brain.memories.statement_hash` and its uniqueness constraint.
--
-- Depends on: 20260916091000_init_core_tables.sql (second_brain.memories)
-- Specified by: docs/DATABASE_SCHEMA.md#memories SHOULD specify this column and
--   does not; see "WHY THIS MIGRATION EXISTS" below.
--
-- WHY THIS MIGRATION EXISTS
--   Four artifacts already assume this column exists and `docs/DATABASE_SCHEMA.md`
--   is the only thing that does not:
--
--     * `packages/database/src/queries/memories.ts` documents
--       "the unique index on `(user_id, statement_hash)`" and treats a violation
--       on it as an exact duplicate;
--     * `services/processing/src/distillation/dedup.ts` names it as tier 1 of
--       deduplication;
--     * `services/processing/src/distillation/merger.ts` requires it to be
--       recomputed whenever a statement is rewritten;
--     * `packages/database/src/types/database.ts` declares it.
--
--   The column is therefore added rather than the four call sites being stripped.
--   docs/DATABASE_SCHEMA.md should gain the column, and the fact that it carries a
--   unique constraint rather than a plain index.
--
-- THE DIGEST CONTRACT — read this before changing anything below
--   `dedup.ts` states it plainly: "The digest must be identical to the
--   `statement_hash` the database layer persists, because that column is the
--   uniqueness key: a hash computed differently here would silently disable
--   exact-duplicate detection without failing anything."
--
--   The application computes `sha256Hex` from `@second-brain/shared` over the
--   WHITESPACE-NORMALIZED statement. `sha256Hex` is lowercase hex of SHA-256 over
--   the UTF-8 bytes. So this migration must reproduce exactly that:
--
--     lower(hex(sha256(utf8_bytes(normalize_whitespace(statement)))))
--
--   `encode(sha256(…), 'hex')` already yields lowercase hex, and `::bytea` over a
--   `text` value uses the database encoding — UTF-8 on Supabase and on the local
--   stack, matching `TextEncoder`. The part that is easy to omit is the
--   normalization: `regexp_replace(statement, '\s+', ' ', 'g')` followed by
--   `btrim` mirrors `normalizeWhitespace`'s `replace(/\s+/g, ' ').trim()`.
--
--   Without the normalization, any statement containing a double space, a
--   newline, or surrounding whitespace would be stored under a digest the
--   application never computes — and nothing would fail. Tier 1 deduplication
--   would simply stop matching. That is a silent quality regression, which is why
--   the normalization is written out inline rather than left implicit.
--
--   Residual, accepted difference: JavaScript's `\s` includes Unicode spaces
--   (U+00A0, U+2028, …) that POSIX `[[:space:]]` does not. A statement containing
--   one of those would hash differently here than in the application. Distilled
--   statements are model-generated prose, so this is not expected to occur; it is
--   recorded rather than solved, because matching JS's full Unicode whitespace
--   class in SQL would need an explicit character class that is far harder to
--   review than the `\s+` above. The application remains the authority: this
--   expression only ever runs as a BACKFILL.
--
-- WHY THE BACKFILL IS A NO-OP TODAY
--   The hosted `second_brain` schema is empty and has never held a `memories` row,
--   and the local stack is rebuilt from these migrations. So `WHERE statement_hash
--   = ''` currently matches nothing. It is written anyway because a migration that
--   adds a NOT NULL column to a table that *could* hold rows must carry its
--   backfill, and "the table happens to be empty" is not a property the next
--   environment will share.
-- ---------------------------------------------------------------------------

-- Step 1: add the column with a placeholder default so existing rows are valid.
alter table second_brain.memories
  add column if not exists statement_hash text not null default '';

comment on column second_brain.memories.statement_hash is
  'Lowercase-hex SHA-256 over the whitespace-normalized statement, matching '
  'sha256Hex from @second-brain/shared. Written by services/processing on every '
  'insert and on every statement rewrite (see distillation/merger.ts). The '
  'uniqueness key is (user_id, statement_hash) — tier 1 of deduplication, and the '
  'reason a digest computed differently would silently disable exact matching '
  'instead of failing.';

-- Step 2: backfill. See the digest contract above — the normalization is load-bearing.
update second_brain.memories
set statement_hash = encode(
      sha256(btrim(regexp_replace(statement, '\s+', ' ', 'g'))::bytea),
      'hex'
    )
where statement_hash = '';

-- Step 3: drop the placeholder default. The column is NOT NULL with no default
-- from here on, so a caller that forgets it gets a loud error rather than a row
-- whose hash matches nothing.
alter table second_brain.memories
  alter column statement_hash drop default;

-- Step 4: the uniqueness key the data layer documents. `if not exists` keeps the
-- statement replayable, matching the convention used by every other index in
-- 20260916093000_init_indexes.sql.
create unique index if not exists memories_user_statement_hash_key
  on second_brain.memories (user_id, statement_hash);
