export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      projecthub_integration_audit_events: {
        Row: {
          action: string;
          actor_n3_user_id: string | null;
          correlation_id: string;
          event_type: string;
          id: string;
          metadata: Json;
          occurred_at: string;
          outcome: string;
          target_identity: string | null;
          target_type: string | null;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_n3_user_id?: string | null;
          correlation_id: string;
          event_type: string;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          outcome: string;
          target_identity?: string | null;
          target_type?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_n3_user_id?: string | null;
          correlation_id?: string;
          event_type?: string;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          outcome?: string;
          target_identity?: string | null;
          target_type?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_integration_audit_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      projecthub_n3_request_diagnostics: {
        Row: {
          actor_n3_user_id: string | null;
          correlation_id: string;
          ended_at: string;
          error_code: string | null;
          error_message: string | null;
          http_method: string;
          id: string;
          operation_id: string;
          outcome: string;
          response_bytes: number | null;
          started_at: string;
          status_code: number | null;
          tenant_id: string | null;
        };
        Insert: {
          actor_n3_user_id?: string | null;
          correlation_id: string;
          ended_at: string;
          error_code?: string | null;
          error_message?: string | null;
          http_method?: string;
          id?: string;
          operation_id: string;
          outcome: string;
          response_bytes?: number | null;
          started_at: string;
          status_code?: number | null;
          tenant_id?: string | null;
        };
        Update: {
          actor_n3_user_id?: string | null;
          correlation_id?: string;
          ended_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          http_method?: string;
          id?: string;
          operation_id?: string;
          outcome?: string;
          response_bytes?: number | null;
          started_at?: string;
          status_code?: number | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_n3_request_diagnostics_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      projecthub_tenants: {
        Row: {
          company_name: string | null;
          created_at: string;
          id: string;
          n3_tenant_code: string | null;
          n3_tenant_id: string;
          updated_at: string;
        };
        Insert: {
          company_name?: string | null;
          created_at?: string;
          id?: string;
          n3_tenant_code?: string | null;
          n3_tenant_id: string;
          updated_at?: string;
        };
        Update: {
          company_name?: string | null;
          created_at?: string;
          id?: string;
          n3_tenant_code?: string | null;
          n3_tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      projecthub_user_roles: {
        Row: {
          created_at: string;
          display_email: string | null;
          display_name: string | null;
          id: string;
          is_active: boolean;
          n3_user_id: string;
          role: Database["public"]["Enums"]["projecthub_role"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_email?: string | null;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          n3_user_id: string;
          role?: Database["public"]["Enums"]["projecthub_role"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_email?: string | null;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          n3_user_id?: string;
          role?: Database["public"]["Enums"]["projecthub_role"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_user_roles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      projecthub_role: "owner" | "unassigned";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      projecthub_role: ["owner", "unassigned"],
    },
  },
} as const;
