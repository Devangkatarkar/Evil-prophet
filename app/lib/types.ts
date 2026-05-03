export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export type ChangeType = 'added' | 'modified' | 'deleted' | 'unchanged'

export type MemberRole = 'owner' | 'editor' | 'member'

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          display_name: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          email: string
          display_name?: string | null
          avatar_url?: string | null
        }
        Update: {
          display_name?: string | null
          avatar_url?: string | null
        }
      }
      projects: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          owner_id: string
          created_at: string
          updated_at: string
        }
        Insert: {
          name: string
          slug: string
          description?: string | null
          owner_id: string
        }
        Update: {
          name?: string
          description?: string | null
          updated_at?: string
        }
      }
      project_members: {
        Row: {
          project_id: string
          user_id: string
          role: MemberRole
          joined_at: string
        }
        Insert: {
          project_id: string
          user_id: string
          role: MemberRole
        }
        Update: {
          role?: MemberRole
        }
      }
      pending_invitations: {
        Row: {
          id: string
          project_id: string
          email: string
          invited_by: string
          created_at: string
        }
        Insert: {
          project_id: string
          email: string
          invited_by: string
        }
      }
      files: {
        Row: {
          id: string
          project_id: string
          file_path: string
          file_name: string
          size_bytes: number
          sha256_hash: string
          storage_path: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          project_id: string
          file_path: string
          file_name: string
          size_bytes: number
          sha256_hash: string
          storage_path: string
          updated_by: string
        }
        Update: {
          sha256_hash?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          updated_by?: string
        }
      }
      activity_logs: {
        Row: {
          id: string
          project_id: string
          session_id: string
          user_id: string
          change_type: ChangeType
          file_path: string
          file_size: number | null
          old_hash: string | null
          new_hash: string | null
          created_at: string
        }
        Insert: {
          project_id: string
          session_id: string
          user_id: string
          change_type: ChangeType
          file_path: string
          file_size?: number | null
          old_hash?: string | null
          new_hash?: string | null
        }
      }
      notification_rate_limits: {
        Row: {
          user_id: string
          project_id: string
          last_sent_at: string
        }
        Insert: {
          user_id: string
          project_id: string
          last_sent_at: string
        }
        Update: {
          last_sent_at?: string
        }
      }
    }
  }
}

// Convenience types
export type Project       = Database['public']['Tables']['projects']['Row']
export type Profile       = Database['public']['Tables']['profiles']['Row']
export type ActivityLog   = Database['public']['Tables']['activity_logs']['Row']
export type ProjectMember = Database['public']['Tables']['project_members']['Row']
export type FileRecord    = Database['public']['Tables']['files']['Row']

export interface MemberWithProfile extends Profile {
  role: MemberRole
}

export interface FileManifestItem {
  path: string
  name: string
  sizeBytes: number
  hash: string
}

export interface ChangeResult {
  added: FileManifestItem[]
  modified: Array<FileManifestItem & { oldHash: string }>
  deleted: Array<{ path: string }>
  unchanged: number
}

export interface SessionSummary {
  sessionId: string
  uploadedBy: Profile
  createdAt: string
  added: number
  modified: number
  deleted: number
  logs: ActivityLog[]
}

export interface DiffLine {
  type: 'added' | 'deleted' | 'context'
  content: string
  lineNumOld: number | null
  lineNumNew: number | null
}

export interface DiffResult {
  lines: DiffLine[]
  stats: { added: number; deleted: number }
  oldHash: string | null
  newHash: string | null
  reason?: 'binary' | 'too_large' | 'no_previous_version' | 'added'
}
