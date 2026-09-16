/**
 * Generated Supabase database types — PLACEHOLDER, DO NOT EDIT.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * This file is machine-generated. The root script
 *
 *     pnpm db:types
 *     supabase gen types typescript --local > packages/database/src/types/database.ts
 *
 * rewrites it in full, so every hand edit here is lost the next time a migration
 * lands. It exists in the scaffold for one reason only: so that `@second-brain/database`
 * type-checks before the first migration is written. Treat the real generated file
 * as authoritative the moment `supabase/migrations/` exists.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * The row shapes below are hand-derived from the shared domain types in
 * `@second-brain/shared` (camelCase there, snake_case columns here) so that a
 * reviewer can compare them field by field. Two deliberate notes on that mapping:
 *
 * - Every object lives in the **`second_brain` schema**, not `public`. The
 *   top-level key therefore reads `second_brain`, matching what
 *   `supabase gen types` emits once the real migrations land. `pnpm db:types`
 *   regenerates it with the correct key automatically; do not hand-edit it to
 *   `public`.
 * - `pgvector` columns (`embedding`, `centroid`) are typed `number[] | null` here
 *   to match `DocumentChunk.embedding`, `Memory.embedding` and `Topic.centroid`.
 *   A live `supabase gen types` run renders them as `string` — the literal
 *   `'[1,2,3]'` form — because that is what PostgREST returns unless the query
 *   casts or a parser is installed. The query modules own that conversion.
 * - Relation-valued fields of the domain types (`Document.topicIds`,
 *   `Memory.topicIds`) map either to a join table (`document_topics`) or to a
 *   denormalized array column (`memories.topic_ids`), which is why one appears in
 *   the row shape and the other does not.
 */

/** Any value PostgREST can round-trip through a `jsonb` column. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** The database as PostgREST sees it. Parameterises `SupabaseClient<Database>`. */
export type Database = {
  second_brain: {
    Tables: {
      activity_events: {
        Row: {
          app_label: string | null;
          bytes: number | null;
          channel_name: string | null;
          content_hash: string | null;
          context_after: string | null;
          context_before: string | null;
          dedupe_key: string;
          device_id: string;
          domain: string | null;
          duration_ms: number | null;
          duration_seconds: number | null;
          end_at: string | null;
          engine: string | null;
          filename: string | null;
          folder: string | null;
          id: string;
          importance: number;
          is_foreground: boolean | null;
          metadata: Json;
          mime_type: string | null;
          occurred_at: string;
          package_name: string | null;
          query: string | null;
          reading_time_seconds: number | null;
          received_at: string;
          scroll_depth_pct: number | null;
          selection_length: number | null;
          start_at: string | null;
          text: string | null;
          title: string | null;
          transcript_available: boolean | null;
          type: Database['second_brain']['Enums']['activity_event_type'];
          url: string | null;
          user_id: string;
          video_id: string | null;
          watched_pct: number | null;
          watched_seconds: number | null;
          word_count: number | null;
        };
        Insert: {
          app_label?: string | null;
          bytes?: number | null;
          channel_name?: string | null;
          content_hash?: string | null;
          context_after?: string | null;
          context_before?: string | null;
          dedupe_key: string;
          device_id: string;
          domain?: string | null;
          duration_ms?: number | null;
          duration_seconds?: number | null;
          end_at?: string | null;
          engine?: string | null;
          filename?: string | null;
          folder?: string | null;
          id: string;
          importance: number;
          is_foreground?: boolean | null;
          metadata?: Json;
          mime_type?: string | null;
          occurred_at: string;
          package_name?: string | null;
          query?: string | null;
          reading_time_seconds?: number | null;
          received_at?: string;
          scroll_depth_pct?: number | null;
          selection_length?: number | null;
          start_at?: string | null;
          text?: string | null;
          title?: string | null;
          transcript_available?: boolean | null;
          type: Database['second_brain']['Enums']['activity_event_type'];
          url?: string | null;
          user_id: string;
          video_id?: string | null;
          watched_pct?: number | null;
          watched_seconds?: number | null;
          word_count?: number | null;
        };
        Update: {
          app_label?: string | null;
          bytes?: number | null;
          channel_name?: string | null;
          content_hash?: string | null;
          context_after?: string | null;
          context_before?: string | null;
          dedupe_key?: string;
          device_id?: string;
          domain?: string | null;
          duration_ms?: number | null;
          duration_seconds?: number | null;
          end_at?: string | null;
          engine?: string | null;
          filename?: string | null;
          folder?: string | null;
          id?: string;
          importance?: number;
          is_foreground?: boolean | null;
          metadata?: Json;
          mime_type?: string | null;
          occurred_at?: string;
          package_name?: string | null;
          query?: string | null;
          reading_time_seconds?: number | null;
          received_at?: string;
          scroll_depth_pct?: number | null;
          selection_length?: number | null;
          start_at?: string | null;
          text?: string | null;
          title?: string | null;
          transcript_available?: boolean | null;
          type?: Database['second_brain']['Enums']['activity_event_type'];
          url?: string | null;
          user_id?: string;
          video_id?: string | null;
          watched_pct?: number | null;
          watched_seconds?: number | null;
          word_count?: number | null;
        };
      };
      devices: {
        Row: {
          app_version: string | null;
          created_at: string;
          id: string;
          label: string;
          last_seen_at: string;
          os_version: string | null;
          platform: Database['second_brain']['Enums']['device_platform'];
          revoked_at: string | null;
          user_id: string;
        };
        Insert: {
          app_version?: string | null;
          created_at?: string;
          id?: string;
          label: string;
          last_seen_at?: string;
          os_version?: string | null;
          platform: Database['second_brain']['Enums']['device_platform'];
          revoked_at?: string | null;
          user_id: string;
        };
        Update: {
          app_version?: string | null;
          created_at?: string;
          id?: string;
          label?: string;
          last_seen_at?: string;
          os_version?: string | null;
          platform?: Database['second_brain']['Enums']['device_platform'];
          revoked_at?: string | null;
          user_id?: string;
        };
      };
      document_chunks: {
        Row: {
          content_hash: string;
          document_id: string;
          embedding: number[] | null;
          embedding_model: string | null;
          heading_path: string[];
          id: string;
          ordinal: number;
          strategy: Database['second_brain']['Enums']['chunking_strategy'];
          text: string;
          token_count: number;
          user_id: string;
        };
        Insert: {
          content_hash: string;
          document_id: string;
          embedding?: number[] | null;
          embedding_model?: string | null;
          heading_path?: string[];
          id?: string;
          ordinal: number;
          strategy: Database['second_brain']['Enums']['chunking_strategy'];
          text: string;
          token_count: number;
          user_id: string;
        };
        Update: {
          content_hash?: string;
          document_id?: string;
          embedding?: number[] | null;
          embedding_model?: string | null;
          heading_path?: string[];
          id?: string;
          ordinal?: number;
          strategy?: Database['second_brain']['Enums']['chunking_strategy'];
          text?: string;
          token_count?: number;
          user_id?: string;
        };
      };
      document_topics: {
        Row: {
          assigned_at: string;
          confidence: number;
          document_id: string;
          is_primary: boolean;
          topic_id: string;
        };
        Insert: {
          assigned_at?: string;
          confidence: number;
          document_id: string;
          is_primary?: boolean;
          topic_id: string;
        };
        Update: {
          assigned_at?: string;
          confidence?: number;
          document_id?: string;
          is_primary?: boolean;
          topic_id?: string;
        };
      };
      documents: {
        Row: {
          author: string | null;
          canonical_url: string | null;
          captured_at: string;
          content_hash: string;
          device_id: string | null;
          extracted_text: string | null;
          id: string;
          importance: number;
          language: string | null;
          published_at: string | null;
          reading_time_seconds: number;
          site_name: string | null;
          source: Database['second_brain']['Enums']['document_source'];
          summary: string | null;
          title: string;
          url: string | null;
          user_id: string;
          word_count: number;
        };
        Insert: {
          author?: string | null;
          canonical_url?: string | null;
          captured_at: string;
          content_hash: string;
          device_id?: string | null;
          extracted_text?: string | null;
          id?: string;
          importance?: number;
          language?: string | null;
          published_at?: string | null;
          reading_time_seconds?: number;
          site_name?: string | null;
          source: Database['second_brain']['Enums']['document_source'];
          summary?: string | null;
          title: string;
          url?: string | null;
          user_id: string;
          word_count?: number;
        };
        Update: {
          author?: string | null;
          canonical_url?: string | null;
          captured_at?: string;
          content_hash?: string;
          device_id?: string | null;
          extracted_text?: string | null;
          id?: string;
          importance?: number;
          language?: string | null;
          published_at?: string | null;
          reading_time_seconds?: number;
          site_name?: string | null;
          source?: Database['second_brain']['Enums']['document_source'];
          summary?: string | null;
          title?: string;
          url?: string | null;
          user_id?: string;
          word_count?: number;
        };
      };
      memories: {
        Row: {
          access_count: number;
          confidence: number;
          created_at: string;
          embedding: number[] | null;
          embedding_model: string | null;
          id: string;
          importance: number;
          kind: Database['second_brain']['Enums']['memory_kind'];
          last_accessed_at: string | null;
          source_chunk_ids: string[];
          source_document_ids: string[];
          statement: string;
          statement_hash: string;
          status: Database['second_brain']['Enums']['memory_status'];
          superseded_by: string | null;
          topic_ids: string[];
          updated_at: string;
          user_id: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          access_count?: number;
          confidence: number;
          created_at?: string;
          embedding?: number[] | null;
          embedding_model?: string | null;
          id?: string;
          importance?: number;
          kind: Database['second_brain']['Enums']['memory_kind'];
          last_accessed_at?: string | null;
          source_chunk_ids?: string[];
          source_document_ids?: string[];
          statement: string;
          statement_hash: string;
          status?: Database['second_brain']['Enums']['memory_status'];
          superseded_by?: string | null;
          topic_ids?: string[];
          updated_at?: string;
          user_id: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          access_count?: number;
          confidence?: number;
          created_at?: string;
          embedding?: number[] | null;
          embedding_model?: string | null;
          id?: string;
          importance?: number;
          kind?: Database['second_brain']['Enums']['memory_kind'];
          last_accessed_at?: string | null;
          source_chunk_ids?: string[];
          source_document_ids?: string[];
          statement?: string;
          statement_hash?: string;
          status?: Database['second_brain']['Enums']['memory_status'];
          superseded_by?: string | null;
          topic_ids?: string[];
          updated_at?: string;
          user_id?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
      };
      memory_sources: {
        Row: {
          chunk_id: string;
          created_at: string;
          document_id: string;
          memory_id: string;
          similarity: number | null;
        };
        Insert: {
          chunk_id: string;
          created_at?: string;
          document_id: string;
          memory_id: string;
          similarity?: number | null;
        };
        Update: {
          chunk_id?: string;
          created_at?: string;
          document_id?: string;
          memory_id?: string;
          similarity?: number | null;
        };
      };
      topics: {
        Row: {
          category_slug: string;
          centroid: number[] | null;
          description: string | null;
          document_count: number;
          first_seen_at: string;
          id: string;
          keywords: string[];
          label: string;
          last_seen_at: string;
          memory_count: number;
          parent_id: string | null;
          slug: string;
          user_id: string;
        };
        Insert: {
          category_slug: string;
          centroid?: number[] | null;
          description?: string | null;
          document_count?: number;
          first_seen_at?: string;
          id?: string;
          keywords?: string[];
          label: string;
          last_seen_at?: string;
          memory_count?: number;
          parent_id?: string | null;
          slug: string;
          user_id: string;
        };
        Update: {
          category_slug?: string;
          centroid?: number[] | null;
          description?: string | null;
          document_count?: number;
          first_seen_at?: string;
          id?: string;
          keywords?: string[];
          label?: string;
          last_seen_at?: string;
          memory_count?: number;
          parent_id?: string | null;
          slug?: string;
          user_id?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      /**
       * Hybrid retrieval: fuses pgvector similarity with full-text rank and
       * returns one ranked list across chunks and memories.
       */
      hybrid_search: {
        Args: {
          fts_weight: number;
          include_documents?: boolean;
          include_memories?: boolean;
          kind_filter?: Database['second_brain']['Enums']['memory_kind'][] | null;
          match_count: number;
          query_embedding: number[];
          query_text: string;
          topic_filter?: string[] | null;
          user_id: string;
          vector_weight: number;
        };
        Returns: Array<{
          document_id: string | null;
          fts_score: number | null;
          id: string;
          occurred_at: string | null;
          score: number;
          source: 'document' | 'memory';
          text: string;
          title: string;
          url: string | null;
          vector_score: number | null;
        }>;
      };
      /** Vector similarity over `document_chunks` for one user, ordered by distance. */
      match_chunks: {
        Args: {
          match_count: number;
          match_threshold?: number;
          query_embedding: number[];
          user_id: string;
        };
        Returns: Array<{
          chunk_id: string;
          document_id: string;
          heading_path: string[];
          ordinal: number;
          similarity: number;
          text: string;
        }>;
      };
      /** Vector similarity over active `memories` for one user, ordered by distance. */
      match_memories: {
        Args: {
          kind_filter?: Database['second_brain']['Enums']['memory_kind'][] | null;
          match_count: number;
          match_threshold?: number;
          query_embedding: number[];
          user_id: string;
        };
        Returns: Array<{
          confidence: number;
          kind: Database['second_brain']['Enums']['memory_kind'];
          memory_id: string;
          similarity: number;
          statement: string;
        }>;
      };
    };
    Enums: {
      activity_event_type:
        | 'page_view'
        | 'page_read'
        | 'selection'
        | 'copy'
        | 'youtube_watch'
        | 'app_session'
        | 'search'
        | 'bookmark'
        | 'download';
      chunking_strategy: 'recursive' | 'semantic' | 'fixed';
      device_platform: 'chrome-extension' | 'android' | 'web' | 'api';
      document_source: 'web' | 'youtube' | 'pdf' | 'gdoc' | 'newsletter' | 'manual';
      memory_kind:
        | 'fact'
        | 'preference'
        | 'decision'
        | 'project'
        | 'entity'
        | 'insight'
        | 'task'
        | 'reference';
      memory_status: 'candidate' | 'active' | 'superseded' | 'archived' | 'rejected';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

/** A table's row shape: `Tables<'documents'>`. */
export type Tables<T extends keyof Database['second_brain']['Tables']> =
  Database['second_brain']['Tables'][T]['Row'];

/** A table's insert shape: `TablesInsert<'document_chunks'>`. */
export type TablesInsert<T extends keyof Database['second_brain']['Tables']> =
  Database['second_brain']['Tables'][T]['Insert'];

/** A table's update shape: `TablesUpdate<'memories'>`. */
export type TablesUpdate<T extends keyof Database['second_brain']['Tables']> =
  Database['second_brain']['Tables'][T]['Update'];

/** An enum's member union: `Enums<'memory_kind'>`. */
export type Enums<T extends keyof Database['second_brain']['Enums']> =
  Database['second_brain']['Enums'][T];

/** Runtime enum members, mirroring what `supabase gen types` emits alongside the types. */
export const Constants = {
  second_brain: {
    Enums: {
      activity_event_type: [
        'page_view',
        'page_read',
        'selection',
        'copy',
        'youtube_watch',
        'app_session',
        'search',
        'bookmark',
        'download',
      ],
      chunking_strategy: ['recursive', 'semantic', 'fixed'],
      device_platform: ['chrome-extension', 'android', 'web', 'api'],
      document_source: ['web', 'youtube', 'pdf', 'gdoc', 'newsletter', 'manual'],
      memory_kind: [
        'fact',
        'preference',
        'decision',
        'project',
        'entity',
        'insight',
        'task',
        'reference',
      ],
      memory_status: ['candidate', 'active', 'superseded', 'archived', 'rejected'],
    },
  },
} as const;
