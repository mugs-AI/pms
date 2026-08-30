export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      projecthub_boq_items: {
        Row: {
          boq_version_id: string;
          cost_rate: number;
          created_at: string;
          created_by_n3_user_id: string | null;
          description: string;
          id: string;
          item_type: string;
          line_number: number;
          n3_stock_id: string | null;
          n3_tax_code_id: string | null;
          n3_uom_id: string | null;
          notes: string | null;
          project_id: string;
          project_phase_id: string;
          quantity: number;
          section_id: string | null;
          selling_rate: number;
          stock_code: string | null;
          stock_deduction_method: string | null;
          stock_name: string | null;
          tax_code: string | null;
          tax_rate: number | null;
          tenant_id: string;
          uom_code: string | null;
          uom_name: string | null;
          updated_at: string;
          updated_by_n3_user_id: string | null;
        };
        Insert: {
          boq_version_id: string;
          cost_rate?: number;
          created_at?: string;
          created_by_n3_user_id?: string | null;
          description: string;
          id?: string;
          item_type: string;
          line_number?: number;
          n3_stock_id?: string | null;
          n3_tax_code_id?: string | null;
          n3_uom_id?: string | null;
          notes?: string | null;
          project_id: string;
          project_phase_id: string;
          quantity: number;
          section_id?: string | null;
          selling_rate?: number;
          stock_code?: string | null;
          stock_deduction_method?: string | null;
          stock_name?: string | null;
          tax_code?: string | null;
          tax_rate?: number | null;
          tenant_id: string;
          uom_code?: string | null;
          uom_name?: string | null;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
        };
        Update: {
          boq_version_id?: string;
          cost_rate?: number;
          created_at?: string;
          created_by_n3_user_id?: string | null;
          description?: string;
          id?: string;
          item_type?: string;
          line_number?: number;
          n3_stock_id?: string | null;
          n3_tax_code_id?: string | null;
          n3_uom_id?: string | null;
          notes?: string | null;
          project_id?: string;
          project_phase_id?: string;
          quantity?: number;
          section_id?: string | null;
          selling_rate?: number;
          stock_code?: string | null;
          stock_deduction_method?: string | null;
          stock_name?: string | null;
          tax_code?: string | null;
          tax_rate?: number | null;
          tenant_id?: string;
          uom_code?: string | null;
          uom_name?: string | null;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_boq_items_phase_fk";
            columns: ["tenant_id", "project_phase_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_project_phases";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_boq_items_project_fk";
            columns: ["tenant_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_projects";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_boq_items_section_fk";
            columns: ["tenant_id", "section_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_boq_sections";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_boq_items_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projecthub_boq_items_version_fk";
            columns: ["tenant_id", "boq_version_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_boq_versions";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      projecthub_boq_sections: {
        Row: {
          boq_version_id: string;
          code: string | null;
          created_at: string;
          id: string;
          name: string;
          project_id: string;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          boq_version_id: string;
          code?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          project_id: string;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          boq_version_id?: string;
          code?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          project_id?: string;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_boq_sections_project_fk";
            columns: ["tenant_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_projects";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_boq_sections_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projecthub_boq_sections_version_fk";
            columns: ["tenant_id", "boq_version_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_boq_versions";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      projecthub_boq_versions: {
        Row: {
          created_at: string;
          created_by_n3_user_id: string | null;
          id: string;
          notes: string | null;
          project_id: string;
          revision_label: string | null;
          source_version_id: string | null;
          status: string;
          tenant_id: string;
          updated_at: string;
          updated_by_n3_user_id: string | null;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          created_by_n3_user_id?: string | null;
          id?: string;
          notes?: string | null;
          project_id: string;
          revision_label?: string | null;
          source_version_id?: string | null;
          status?: string;
          tenant_id: string;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
          version_number: number;
        };
        Update: {
          created_at?: string;
          created_by_n3_user_id?: string | null;
          id?: string;
          notes?: string | null;
          project_id?: string;
          revision_label?: string | null;
          source_version_id?: string | null;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_boq_versions_project_fk";
            columns: ["tenant_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_projects";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_boq_versions_source_fk";
            columns: ["tenant_id", "source_version_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_boq_versions";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_boq_versions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
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
      projecthub_project_events: {
        Row: {
          actor_n3_user_id: string | null;
          correlation_id: string;
          entity_id: string | null;
          entity_type: string | null;
          event_type: string;
          id: string;
          metadata: Json;
          occurred_at: string;
          project_id: string;
          summary: string;
          tenant_id: string;
        };
        Insert: {
          actor_n3_user_id?: string | null;
          correlation_id: string;
          entity_id?: string | null;
          entity_type?: string | null;
          event_type: string;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          project_id: string;
          summary: string;
          tenant_id: string;
        };
        Update: {
          actor_n3_user_id?: string | null;
          correlation_id?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          event_type?: string;
          id?: string;
          metadata?: Json;
          occurred_at?: string;
          project_id?: string;
          summary?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_project_events_project_fk";
            columns: ["tenant_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_projects";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_project_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      projecthub_project_phases: {
        Row: {
          created_at: string;
          created_by_n3_user_id: string | null;
          expected_end_date: string | null;
          expected_start_date: string | null;
          id: string;
          is_active: boolean;
          link_status: string;
          n3_project_code: string | null;
          n3_project_id: string | null;
          n3_project_name: string | null;
          phase_kind: string;
          phase_name: string;
          project_id: string;
          requested_n3_project_code: string | null;
          requested_n3_project_name: string | null;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
          updated_by_n3_user_id: string | null;
        };
        Insert: {
          created_at?: string;
          created_by_n3_user_id?: string | null;
          expected_end_date?: string | null;
          expected_start_date?: string | null;
          id?: string;
          is_active?: boolean;
          link_status: string;
          n3_project_code?: string | null;
          n3_project_id?: string | null;
          n3_project_name?: string | null;
          phase_kind: string;
          phase_name: string;
          project_id: string;
          requested_n3_project_code?: string | null;
          requested_n3_project_name?: string | null;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
        };
        Update: {
          created_at?: string;
          created_by_n3_user_id?: string | null;
          expected_end_date?: string | null;
          expected_start_date?: string | null;
          id?: string;
          is_active?: boolean;
          link_status?: string;
          n3_project_code?: string | null;
          n3_project_id?: string | null;
          n3_project_name?: string | null;
          phase_kind?: string;
          phase_name?: string;
          project_id?: string;
          requested_n3_project_code?: string | null;
          requested_n3_project_name?: string | null;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_phases_project_fk";
            columns: ["tenant_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_projects";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_project_phases_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      projecthub_project_sequences: {
        Row: {
          created_at: string;
          id: string;
          last_value: number;
          sequence_year: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_value?: number;
          sequence_year: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_value?: number;
          sequence_year?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_project_sequences_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      projecthub_project_team_members: {
        Row: {
          assigned_at: string;
          assigned_by_n3_user_id: string | null;
          created_at: string;
          display_email: string | null;
          display_name: string | null;
          id: string;
          is_active: boolean;
          n3_user_id: string;
          project_id: string;
          project_role_snapshot: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by_n3_user_id?: string | null;
          created_at?: string;
          display_email?: string | null;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          n3_user_id: string;
          project_id: string;
          project_role_snapshot?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by_n3_user_id?: string | null;
          created_at?: string;
          display_email?: string | null;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          n3_user_id?: string;
          project_id?: string;
          project_role_snapshot?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_project_team_members_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "projecthub_team_project_fk";
            columns: ["tenant_id", "project_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_projects";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "projecthub_team_user_fk";
            columns: ["tenant_id", "n3_user_id"];
            isOneToOne: false;
            referencedRelation: "projecthub_user_roles";
            referencedColumns: ["tenant_id", "n3_user_id"];
          },
        ];
      };
      projecthub_projects: {
        Row: {
          budget_mode: string;
          cancellation_note: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          client_request_hash: string;
          client_request_id: string;
          created_at: string;
          created_by_n3_user_id: string | null;
          currency_code: string;
          customer_link_status: string;
          description: string | null;
          enquiry_date: string;
          enquiry_reference: string;
          expected_end_date: string | null;
          expected_start_date: string | null;
          id: string;
          n3_customer_code: string | null;
          n3_customer_id: string | null;
          n3_customer_name: string | null;
          project_type: string;
          requested_customer_contact: string | null;
          requested_customer_email: string | null;
          requested_customer_name: string | null;
          requested_customer_phone: string | null;
          simple_budget_cost: number | null;
          simple_budget_selling: number | null;
          site_address_line1: string | null;
          site_address_line2: string | null;
          site_city: string | null;
          site_country: string | null;
          site_postcode: string | null;
          site_state: string | null;
          status: string;
          tenant_id: string;
          title: string;
          updated_at: string;
          updated_by_n3_user_id: string | null;
        };
        Insert: {
          budget_mode?: string;
          cancellation_note?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          client_request_hash: string;
          client_request_id: string;
          created_at?: string;
          created_by_n3_user_id?: string | null;
          currency_code?: string;
          customer_link_status: string;
          description?: string | null;
          enquiry_date?: string;
          enquiry_reference: string;
          expected_end_date?: string | null;
          expected_start_date?: string | null;
          id?: string;
          n3_customer_code?: string | null;
          n3_customer_id?: string | null;
          n3_customer_name?: string | null;
          project_type: string;
          requested_customer_contact?: string | null;
          requested_customer_email?: string | null;
          requested_customer_name?: string | null;
          requested_customer_phone?: string | null;
          simple_budget_cost?: number | null;
          simple_budget_selling?: number | null;
          site_address_line1?: string | null;
          site_address_line2?: string | null;
          site_city?: string | null;
          site_country?: string | null;
          site_postcode?: string | null;
          site_state?: string | null;
          status?: string;
          tenant_id: string;
          title: string;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
        };
        Update: {
          budget_mode?: string;
          cancellation_note?: string | null;
          cancellation_reason?: string | null;
          cancelled_at?: string | null;
          client_request_hash?: string;
          client_request_id?: string;
          created_at?: string;
          created_by_n3_user_id?: string | null;
          currency_code?: string;
          customer_link_status?: string;
          description?: string | null;
          enquiry_date?: string;
          enquiry_reference?: string;
          expected_end_date?: string | null;
          expected_start_date?: string | null;
          id?: string;
          n3_customer_code?: string | null;
          n3_customer_id?: string | null;
          n3_customer_name?: string | null;
          project_type?: string;
          requested_customer_contact?: string | null;
          requested_customer_email?: string | null;
          requested_customer_name?: string | null;
          requested_customer_phone?: string | null;
          simple_budget_cost?: number | null;
          simple_budget_selling?: number | null;
          site_address_line1?: string | null;
          site_address_line2?: string | null;
          site_city?: string | null;
          site_country?: string | null;
          site_postcode?: string | null;
          site_state?: string | null;
          status?: string;
          tenant_id?: string;
          title?: string;
          updated_at?: string;
          updated_by_n3_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "projecthub_projects_tenant_id_fkey";
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
          assigned_at: string | null;
          assigned_by_n3_user_id: string | null;
          created_at: string;
          display_email: string | null;
          display_name: string | null;
          id: string;
          is_active: boolean;
          n3_user_id: string;
          role: Database["public"]["Enums"]["projecthub_role"];
          role_source: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          assigned_at?: string | null;
          assigned_by_n3_user_id?: string | null;
          created_at?: string;
          display_email?: string | null;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          n3_user_id: string;
          role?: Database["public"]["Enums"]["projecthub_role"];
          role_source?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          assigned_at?: string | null;
          assigned_by_n3_user_id?: string | null;
          created_at?: string;
          display_email?: string | null;
          display_name?: string | null;
          id?: string;
          is_active?: boolean;
          n3_user_id?: string;
          role?: Database["public"]["Enums"]["projecthub_role"];
          role_source?: string;
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
      projecthub_clone_boq_version: {
        Args: {
          p_actor: string;
          p_project_id: string;
          p_revision_label: string;
          p_source_version_id: string;
          p_tenant_id: string;
        };
        Returns: string;
      };
      projecthub_create_enquiry: {
        Args: {
          p_actor: string;
          p_correlation_id: string;
          p_payload: Json;
          p_tenant_id: string;
          p_year: number;
        };
        Returns: {
          enquiry_reference: string;
          project_id: string;
          replayed: boolean;
        }[];
      };
      projecthub_next_enquiry_reference: {
        Args: { p_tenant_id: string; p_year: number };
        Returns: string;
      };
    };
    Enums: {
      projecthub_role:
        | "owner"
        | "unassigned"
        | "project_manager"
        | "estimator"
        | "finance"
        | "procurement"
        | "storekeeper"
        | "site_supervisor"
        | "viewer";
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
      projecthub_role: [
        "owner",
        "unassigned",
        "project_manager",
        "estimator",
        "finance",
        "procurement",
        "storekeeper",
        "site_supervisor",
        "viewer",
      ],
    },
  },
} as const;
