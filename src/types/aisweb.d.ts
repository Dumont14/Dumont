// src/types/aisweb.d.ts

export interface RoutespItem {
  /** Identificador único (ident da rota ou id gerado) */
  id: string;
  /** Nome/ident da rota (ex: UZ1, B573) */
  ident?: string;
  /** Nível de espaço aéreo */
  level?: 'L' | 'H' | string;
  /** Tipo de rota (PREF, ALT, OPC…) */
  type?: string;
  /** Aeródromo de origem */
  adep?: string;
  /** Aeródromo de destino */
  ades?: string;
  /** String de rota com fixes/waypoints */
  route?: string;
  /** Coordenadas para desenhar polyline — array de [lat, lng] */
  coords?: [number, number][];
  /** Link para carta/PDF se disponível */
  pdfUrl?: string;
  /** Bounding box [south, west, north, east] */
  bbox?: [number, number, number, number];
  /** Dados brutos para depuração */
  raw?: unknown;
}

export type ErcLevel = 'L' | 'H' | 'ALL';
