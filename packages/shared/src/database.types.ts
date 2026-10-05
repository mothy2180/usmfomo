
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "notices": {
                  Row: {
                    "body": string,"created_at": string,"ends_at": string,"id": string,"link_url": string | null,"starts_at": string,"title": string,"updated_at": string
                  }
                  Insert: {
                    "body": string,"created_at"?: string,"ends_at": string,"id"?: string,"link_url"?: string | null,"starts_at"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"created_at"?: string,"ends_at"?: string,"id"?: string,"link_url"?: string | null,"starts_at"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                },"orgs": {
                  Row: {
                    "active": boolean,"campus": Database["public"]['Enums']["campus"],"created_at": string,"id": string,"name": string,"slug": string,"type": Database["public"]['Enums']["org_type"]
                  }
                  Insert: {
                    "active"?: boolean,"campus"?: Database["public"]['Enums']["campus"],"created_at"?: string,"id"?: string,"name": string,"slug": string,"type": Database["public"]['Enums']["org_type"]
                  }
                  Update: {
                    "active"?: boolean,"campus"?: Database["public"]['Enums']["campus"],"created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"type"?: Database["public"]['Enums']["org_type"]
                  }
                  Relationships: [

                  ]
                },"posts": {
                  Row: {
                    "campus": Database["public"]['Enums']["campus"],"cancelled_at": string | null,"created_at": string,"description": string | null,"details_changed_at": string | null,"ends_at": string,"hidden_at": string | null,"id": string,"link_url": string | null,"org_id": string,"poster_path": string | null,"starts_at": string,"thumb_path": string | null,"title": string,"updated_at": string,"venue": string
                  }
                  Insert: {
                    "campus"?: Database["public"]['Enums']["campus"],"cancelled_at"?: string | null,"created_at"?: string,"description"?: string | null,"details_changed_at"?: string | null,"ends_at": string,"hidden_at"?: string | null,"id"?: string,"link_url"?: string | null,"org_id": string,"poster_path"?: string | null,"starts_at": string,"thumb_path"?: string | null,"title": string,"updated_at"?: string,"venue": string
                  }
                  Update: {
                    "campus"?: Database["public"]['Enums']["campus"],"cancelled_at"?: string | null,"created_at"?: string,"description"?: string | null,"details_changed_at"?: string | null,"ends_at"?: string,"hidden_at"?: string | null,"id"?: string,"link_url"?: string | null,"org_id"?: string,"poster_path"?: string | null,"starts_at"?: string,"thumb_path"?: string | null,"title"?: string,"updated_at"?: string,"venue"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "posts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"site_settings": {
                  Row: {
                    "id": number,"posting_enabled": boolean,"public_reads_enabled": boolean,"updated_at": string
                  }
                  Insert: {
                    "id"?: number,"posting_enabled"?: boolean,"public_reads_enabled"?: boolean,"updated_at"?: string
                  }
                  Update: {
                    "id"?: number,"posting_enabled"?: boolean,"public_reads_enabled"?: boolean,"updated_at"?: string
                  }
                  Relationships: [

                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_create_org_account":
{ Args: { "p_campus": Database["public"]['Enums']["campus"],"p_org_name": string,"p_org_slug": string,"p_type": Database["public"]['Enums']["org_type"],"p_user": string,"p_username": string }; Returns: string
                           },
"admin_delete_org":
{ Args: { "p_org": string }; Returns: undefined
                           },
"admin_delete_post":
{ Args: { "p_post": string }; Returns: {
              "poster_path": string,"thumb_path": string
            }[]
                           },
"admin_is_owner":
{ Args: { "p_uid": string }; Returns: boolean
                           },
"admin_link_owner":
{ Args: { "p_user": string,"p_username": string }; Returns: undefined
                           },
"admin_list_accounts":
{ Args: Record<PropertyKey, never>; Returns: {
              "account_active": boolean,"banned_until": string,"created_at": string,"factor_count": number,"is_owner": boolean,"last_sign_in_at": string,"live_posts": number,"newest_factor_at": string,"org_active": boolean,"org_campus": Database["public"]['Enums']["campus"],"org_id": string,"org_name": string,"org_slug": string,"org_type": Database["public"]['Enums']["org_type"],"user_id": string,"username": string
            }[]
                           },
"admin_org_objects":
{ Args: { "p_org": string }; Returns: {
              "name": string
            }[]
                           },
"admin_remove_post_image":
{ Args: { "p_post": string }; Returns: {
              "poster_path": string,"thumb_path": string
            }[]
                           },
"admin_set_account_active":
{ Args: { "p_active": boolean,"p_user": string }; Returns: undefined
                           },
"admin_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_update_org":
{ Args: { "p_active": boolean,"p_campus": Database["public"]['Enums']["campus"],"p_name": string,"p_org": string,"p_slug": string,"p_type": Database["public"]['Enums']["org_type"] }; Returns: undefined
                           },
"maint_heartbeat":
{ Args: { "p_result"?: Json }; Returns: string
                           },
"maint_orphans":
{ Args: { "p_limit"?: number,"p_older_than"?: string }; Returns: {
              "name": string
            }[]
                           },
"maint_purge_expired":
{ Args: { "p_limit"?: number }; Returns: {
              "id": string,"kind": string,"poster_path": string,"thumb_path": string
            }[]
                           },
"maint_retention":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_posting_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"search_posts":
{ Args: { "p_campus"?: Database["public"]['Enums']["campus"],"p_limit"?: number,"p_offset"?: number,"p_org"?: string,"p_q"?: string,"p_type": Database["public"]['Enums']["org_type"] }; Returns: {
              "campus": Database["public"]['Enums']["campus"],"cancelled_at": string,"details_changed_at": string,"ends_at": string,"id": string,"org_id": string,"org_name": string,"org_slug": string,"org_type": Database["public"]['Enums']["org_type"],"starts_at": string,"thumb_path": string,"title": string,"total": number,"venue": string
            }[]
                           }
          }
          Enums: {
            "campus": "main"|"engineering"|"health"|"other"|"online","org_type": "club"|"school"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "campus": ["main", "engineering", "health", "other", "online"],"org_type": ["club", "school"]
          }
        }
} as const
