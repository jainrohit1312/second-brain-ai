export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  second_brain: {
    Tables: {
      activity_events: {
        Row: {
          dedupe_key: string
          device_id: string
          domain: string | null
          duration_seconds: number | null
          id: string
          importance: number
          importance_band: string
          importance_version: string | null
          metadata: Json
          occurred_at: string
          payload: Json
          received_at: string
          server_importance: number | null
          title: string | null
          type: string
          url: string | null
          user_id: string
        }
        Insert: {
          dedupe_key: string
          device_id: string
          domain?: string | null
          duration_seconds?: number | null
          id?: string
          importance?: number
          importance_band?: string
          importance_version?: string | null
          metadata?: Json
          occurred_at: string
          payload?: Json
          received_at?: string
          server_importance?: number | null
          title?: string | null
          type: string
          url?: string | null
          user_id: string
        }
        Update: {
          dedupe_key?: string
          device_id?: string
          domain?: string | null
          duration_seconds?: number | null
          id?: string
          importance?: number
          importance_band?: string
          importance_version?: string | null
          metadata?: Json
          occurred_at?: string
          payload?: Json
          received_at?: string
          server_importance?: number | null
          title?: string | null
          type?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_device_fk"
            columns: ["device_id", "user_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      devices: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          ingest_secret_hash: string | null
          ingest_secret_rotated_at: string | null
          label: string
          last_seen_at: string
          os_version: string | null
          platform: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          ingest_secret_hash?: string | null
          ingest_secret_rotated_at?: string | null
          label?: string
          last_seen_at?: string
          os_version?: string | null
          platform: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          ingest_secret_hash?: string | null
          ingest_secret_rotated_at?: string | null
          label?: string
          last_seen_at?: string
          os_version?: string | null
          platform?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          content_hash: string
          created_at: string
          document_id: string
          embedding: string | null
          embedding_model: string | null
          fts: unknown
          heading_path: string[]
          id: string
          ordinal: number
          strategy: string
          text: string
          token_count: number
          user_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          document_id: string
          embedding?: string | null
          embedding_model?: string | null
          fts?: unknown
          heading_path?: string[]
          id?: string
          ordinal: number
          strategy: string
          text: string
          token_count?: number
          user_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          embedding_model?: string | null
          fts?: unknown
          heading_path?: string[]
          id?: string
          ordinal?: number
          strategy?: string
          text?: string
          token_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_fk"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      document_topics: {
        Row: {
          assigned_at: string
          classification_version: string | null
          confidence: number
          document_id: string
          is_primary: boolean
          topic_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          classification_version?: string | null
          confidence: number
          document_id: string
          is_primary?: boolean
          topic_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          classification_version?: string | null
          confidence?: number
          document_id?: string
          is_primary?: boolean
          topic_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_topics_document_fk"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "document_topics_topic_fk"
            columns: ["topic_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      documents: {
        Row: {
          author: string | null
          canonical_url: string | null
          captured_at: string
          content_hash: string
          created_at: string
          deleted_at: string | null
          device_id: string | null
          extracted_text: string | null
          extraction_failure_reason: string | null
          extraction_status: string
          extraction_version: string | null
          fts: unknown
          id: string
          importance: number
          language: string | null
          last_seen_at: string
          published_at: string | null
          reading_time_seconds: number
          site_name: string | null
          source: string
          summary: string | null
          title: string
          topic_ids: string[]
          updated_at: string
          url: string | null
          user_id: string
          word_count: number
        }
        Insert: {
          author?: string | null
          canonical_url?: string | null
          captured_at?: string
          content_hash: string
          created_at?: string
          deleted_at?: string | null
          device_id?: string | null
          extracted_text?: string | null
          extraction_failure_reason?: string | null
          extraction_status?: string
          extraction_version?: string | null
          fts?: unknown
          id?: string
          importance?: number
          language?: string | null
          last_seen_at?: string
          published_at?: string | null
          reading_time_seconds?: number
          site_name?: string | null
          source: string
          summary?: string | null
          title?: string
          topic_ids?: string[]
          updated_at?: string
          url?: string | null
          user_id: string
          word_count?: number
        }
        Update: {
          author?: string | null
          canonical_url?: string | null
          captured_at?: string
          content_hash?: string
          created_at?: string
          deleted_at?: string | null
          device_id?: string | null
          extracted_text?: string | null
          extraction_failure_reason?: string | null
          extraction_status?: string
          extraction_version?: string | null
          fts?: unknown
          id?: string
          importance?: number
          language?: string | null
          last_seen_at?: string
          published_at?: string | null
          reading_time_seconds?: number
          site_name?: string | null
          source?: string
          summary?: string | null
          title?: string
          topic_ids?: string[]
          updated_at?: string
          url?: string | null
          user_id?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_device_fk"
            columns: ["device_id", "user_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      memories: {
        Row: {
          access_count: number
          confidence: number
          created_at: string
          distillation_model: string | null
          distillation_prompt_version: string | null
          embedding: string | null
          embedding_model: string | null
          fts: unknown
          id: string
          importance: number
          kind: string
          last_accessed_at: string | null
          source_chunk_ids: string[]
          source_document_ids: string[]
          statement: string
          statement_hash: string
          status: string
          superseded_by: string | null
          topic_ids: string[]
          updated_at: string
          user_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          access_count?: number
          confidence?: number
          created_at?: string
          distillation_model?: string | null
          distillation_prompt_version?: string | null
          embedding?: string | null
          embedding_model?: string | null
          fts?: unknown
          id?: string
          importance?: number
          kind: string
          last_accessed_at?: string | null
          source_chunk_ids?: string[]
          source_document_ids?: string[]
          statement: string
          statement_hash: string
          status?: string
          superseded_by?: string | null
          topic_ids?: string[]
          updated_at?: string
          user_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          access_count?: number
          confidence?: number
          created_at?: string
          distillation_model?: string | null
          distillation_prompt_version?: string | null
          embedding?: string | null
          embedding_model?: string | null
          fts?: unknown
          id?: string
          importance?: number
          kind?: string
          last_accessed_at?: string | null
          source_chunk_ids?: string[]
          source_document_ids?: string[]
          statement?: string
          statement_hash?: string
          status?: string
          superseded_by?: string | null
          topic_ids?: string[]
          updated_at?: string
          user_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memories_superseded_by_fk"
            columns: ["superseded_by", "user_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      memory_sources: {
        Row: {
          chunk_id: string
          created_at: string
          document_id: string
          excerpt: string
          memory_id: string
          similarity: number | null
          user_id: string
        }
        Insert: {
          chunk_id: string
          created_at?: string
          document_id: string
          excerpt: string
          memory_id: string
          similarity?: number | null
          user_id: string
        }
        Update: {
          chunk_id?: string
          created_at?: string
          document_id?: string
          excerpt?: string
          memory_id?: string
          similarity?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_sources_chunk_fk"
            columns: ["chunk_id", "user_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "memory_sources_document_fk"
            columns: ["document_id", "user_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "memory_sources_memory_fk"
            columns: ["memory_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memories"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      topics: {
        Row: {
          category_slug: string
          centroid: string | null
          centroid_model: string | null
          description: string | null
          document_count: number
          first_seen_at: string
          id: string
          keywords: string[]
          label: string
          last_seen_at: string
          memory_count: number
          parent_id: string | null
          slug: string
          user_id: string
        }
        Insert: {
          category_slug?: string
          centroid?: string | null
          centroid_model?: string | null
          description?: string | null
          document_count?: number
          first_seen_at?: string
          id?: string
          keywords?: string[]
          label: string
          last_seen_at?: string
          memory_count?: number
          parent_id?: string | null
          slug: string
          user_id: string
        }
        Update: {
          category_slug?: string
          centroid?: string | null
          centroid_model?: string | null
          description?: string | null
          document_count?: number
          first_seen_at?: string
          id?: string
          keywords?: string[]
          label?: string
          last_seen_at?: string
          memory_count?: number
          parent_id?: string | null
          slug?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "topics_parent_fk"
            columns: ["parent_id", "user_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      user_settings: {
        Row: {
          category_weights: Json
          created_at: string
          embedding_model: string
          embedding_provider: string
          excluded_apps: string[]
          excluded_domains: string[]
          importance_rules: Json
          llm_model: string
          llm_provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_weights?: Json
          created_at?: string
          embedding_model?: string
          embedding_provider?: string
          excluded_apps?: string[]
          excluded_domains?: string[]
          importance_rules?: Json
          llm_model?: string
          llm_provider?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category_weights?: Json
          created_at?: string
          embedding_model?: string
          embedding_provider?: string
          excluded_apps?: string[]
          excluded_domains?: string[]
          importance_rules?: Json
          llm_model?: string
          llm_provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      hybrid_search: {
        Args: {
          fts_weight: number
          include_documents?: boolean
          include_memories?: boolean
          kind_filter?: string[]
          match_count: number
          query_embedding: string
          query_text: string
          topic_filter?: string[]
          user_id: string
          vector_weight: number
        }
        Returns: {
          document_id: string
          fts_score: number
          id: string
          occurred_at: string
          score: number
          source: string
          text: string
          title: string
          url: string
          vector_score: number
        }[]
      }
      match_chunks: {
        Args: {
          match_count: number
          match_threshold?: number
          query_embedding: string
          user_id: string
        }
        Returns: {
          chunk_id: string
          document_id: string
          heading_path: string[]
          ordinal: number
          similarity: number
          text: string
        }[]
      }
      match_memories: {
        Args: {
          kind_filter?: string[]
          match_count: number
          match_threshold?: number
          query_embedding: string
          user_id: string
        }
        Returns: {
          confidence: number
          kind: string
          memory_id: string
          similarity: number
          statement: string
        }[]
      }
      search_documents: {
        Args: {
          match_count: number
          min_rank?: number
          query_text: string
          user_id: string
        }
        Returns: {
          captured_at: string
          excerpt: string
          extraction_status: string
          id: string
          rank: number
          title: string
          url: string
          word_count: number
        }[]
      }
      search_documents_hybrid: {
        Args: {
          match_count: number
          min_rank?: number
          query_embedding: string
          query_text: string
          user_id: string
        }
        Returns: {
          captured_at: string
          excerpt: string
          extraction_status: string
          id: string
          rank: number
          title: string
          url: string
          word_count: number
        }[]
      }
      upsert_document_captures: {
        Args: { p_device_id: string; p_documents: Json; p_user_id: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  second_brain: {
    Enums: {},
  },
} as const
