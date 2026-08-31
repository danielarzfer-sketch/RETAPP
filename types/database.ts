// Tipos que reflejan las tablas y vistas de supabase/schema.sql
// (Idealmente, más adelante se generan automáticamente con:
//  npx supabase gen types typescript --project-id TU_PROYECTO)

export type Rol = "miembro" | "admin";
export type TipoEntrenamiento = "carrera" | "fuerza";
export type EstadoEntrenamiento = "pendiente" | "aprobado" | "rechazado";

export interface Profile {
  id: string;
  nombre: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Group {
  id: string;
  nombre: string;
  codigo_invitacion: string;
  created_by: string;
  created_at: string;
}

export interface GroupMember {
  group_id: string;
  user_id: string;
  rol: Rol;
  joined_at: string;
}

export interface Season {
  id: string;
  group_id: string;
  nombre: string;
  fecha_inicio: string;
  fecha_fin: string;
  created_at: string;
}

export interface Challenge {
  id: string;
  season_id: string;
  user_id: string;
  dias_carrera_semana: number;
  dias_fuerza_semana: number;
  created_at: string;
}

export interface Workout {
  id: string;
  season_id: string;
  user_id: string;
  tipo: TipoEntrenamiento;
  fecha: string;
  duracion_minutos: number;
  captura_url: string;
  estado: EstadoEntrenamiento;
  motivo_rechazo: string | null;
  validado_por: string | null;
  validado_en: string | null;
  created_at: string;
}

export interface Settlement {
  id: string;
  group_id: string;
  fecha: string;
  nota: string | null;
  created_by: string;
  created_at: string;
}

export interface SettlementItem {
  id: string;
  settlement_id: string;
  user_id: string;
  season_id: string;
  semana_inicio: string;
  importe: number;
}

// Fila de la vista v_deuda_pendiente
export interface DeudaPendiente {
  season_id: string;
  user_id: string;
  semana_inicio: string;
  importe_deuda: number;
  importe_saldado: number;
  importe_pendiente: number;
}
