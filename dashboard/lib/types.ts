export type Status = "TRUSTED" | "DEGRADED" | "SUSPICIOUS" | "UNTRUSTED";
export type Osnma = "verified" | "pending" | "unavailable" | "failed" | "unknown";

export interface Reason {
  code: string;
  title: string;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  contribution: number;
  detail: string;
}

/** One scored observation, as the engine emits it. */
export interface Frame {
  device_id?: string;
  s: number;
  t?: string;
  lat: number | null;
  lon: number | null;
  trust: number;
  st: Status;
  rr: number;
  mr: number | null;
  hr: number;
  spd: number | null;
  hdg: number | null;
  sats: number | null;
  osnma: Osnma;
  fix: boolean;
  atk: boolean | null;
  kind: string | null;
  f: Record<string, number | null>;
  why: Reason[];
  /** simulator ground truth [lat, lon]; replay only */
  tl?: [number, number];
}

export interface Incident {
  id?: string;
  device_id: string;
  scenario?: string | null;
  severity: "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "RESOLVED";
  title: string;
  start: number;
  end: number;
  opened_at: string;
  closed_at?: string | null;
  min_trust: number;
  observations: number;
  evidence: { code: string; title: string; occurrences: number }[];
}

export interface RouteGeom {
  slug: string;
  name: string;
  role: string;
  profile: string;
  length_m: number;
  points: [number, number][];
}

export interface Scenario {
  slug: string;
  name: string;
  label: string;
  attack: string;
  description: string;
  device_id: string;
  profile: string;
  route: string;
  seed: number;
  observations: number;
  attack_start: number | null;
  attack_observations: number;
  min_trust: number;
  mean_trust: number;
  incident_count: number;
  frames: Frame[];
}

export interface MethodMetrics {
  precision: number;
  recall: number;
  f1: number;
  false_positive_rate: number;
  balanced_accuracy: number;
  roc_auc?: number;
  pr_auc?: number;
  confusion_matrix: { tp: number; fp: number; fn: number; tn: number };
  support_positive: number;
  support_negative: number;
  mean_detection_latency_obs: number | null;
  per_scenario: {
    scenario: string;
    label: string;
    observations: number;
    attack_observations: number;
    alerts: number;
    false_alerts: number;
    detection_latency_obs: number | null;
    detected: boolean;
  }[];
}

export interface ReplayData {
  engine_version: string;
  run_id: string;
  generated_at: string;
  is_synthetic: boolean;
  scenarios: Scenario[];
  routes: Record<string, RouteGeom>;
  route_catalogue: { slug: string; name: string; role: string; profile: string; length_m: number }[];
  incidents: Incident[];
  experiments: Record<"rules" | "ml" | "hybrid", MethodMetrics>;
  fusion_search: {
    chosen: { rule_weight: number; ml_weight: number };
    grid: { rule_weight: number; ml_weight: number; f1: number; false_positive_rate: number }[];
    split: string;
  };
  model: Record<string, unknown> & { model_version: string; feature_count: number; fit_rows: number; calibration_rows: number };
  features: { all: string[]; model: string[] };
  settings: Record<string, any>;
  limitations: string[];
}

export interface Device {
  id: string;
  name: string;
  kind: "vehicle" | "drone";
  profile: string;
  route_slug: string | null;
}

export interface Run {
  id: string;
  mode: "demo_feed" | "live_engine" | "receiver";
  label: string;
  started_at: string;
  ended_at: string | null;
  status: "running" | "finished" | "stopped";
  duration_s: number | null;
  engine_version: string | null;
  model_version: string | null;
}
