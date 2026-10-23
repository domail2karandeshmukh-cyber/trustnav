"""Deterministic synthetic GNSS observations, with and without attacks.

Nothing here transmits or receives radio signals. Each scenario is a seeded
software model of what a receiver would report, so every run is repeatable.

Normal behaviour includes the things that cause false alarms in real life:
traffic stops, cornering, and urban-canyon segments where buildings cut
satellites and raise residuals.

Attack overlays (all labelled per observation as ground truth):
    teleport        abrupt 8 km position jump from a simple GPS-only spoofer
    drift           slow lateral takeover, spoofer power visible in C/N0
    signal          spoofer onset: C/N0 too strong and too uniform, satellites drop
    stealth_drift   relay-style attack: clean signal and OSNMA still verified,
                    only the position is wrong
    osnma_forgery   spoofer forges Galileo navigation data, OSNMA tags fail
    jamming         noise drowns the signal until the fix is lost, then recovers
"""

import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np

from .geo import haversine_m, offset
from .routes import load_routes

DEFAULT_START = datetime(2026, 11, 5, 9, 0, 0, tzinfo=timezone.utc)


@dataclass
class ScenarioSpec:
    slug: str
    name: str
    route: str
    attack: str = "none"
    seed: int = 1
    duration_s: int = 360
    attack_start_s: int = 120
    attack_duration_s: int = 10_000
    description: str = ""
    device_id: str = "VEH-01"
    start_offset_m: float = 0.0
    extra: dict = field(default_factory=dict)

    @property
    def label(self):
        return "normal" if self.attack == "none" else ("jamming" if self.attack == "jamming" else "spoofing")


class AR1:
    """First-order autoregressive noise: smooth, realistic sensor wander."""

    def __init__(self, rng, sigma, rho=0.9, start=0.0):
        self.rng, self.sigma, self.rho, self.v = rng, sigma, rho, start

    def step(self):
        self.v = self.rho * self.v + math.sqrt(1 - self.rho**2) * self.sigma * self.rng.standard_normal()
        return self.v


def _speed_trace(route, spec, rng, drone):
    """True distance-along-route and speed for every second."""
    cruise = 11.0 if drone else (12.5 if route.role != "train" or "loop" in route.slug else 16.0)
    s_grid, limits = route.curvature_speed_limits(cruise, 3.0 if drone else 2.2, step_m=2.0, look_m=10.0)
    stops = []
    if not drone:
        n_stops = rng.integers(1, 4)
        for _ in range(n_stops):
            at = rng.uniform(20, spec.duration_s - 40)
            stops.append((at, at + rng.uniform(8, 22)))
    s, v = spec.start_offset_m % max(route.length_m, 1.0), 0.0
    out = []
    loop = haversine_m(*route.points[0], *route.points[-1]) < 60
    for t in range(spec.duration_s):
        stopped = any(a <= t < b for a, b in stops)
        k = min(int(s / 2.0), len(limits) - 1)
        target = 0.0 if stopped else limits[k] * (0.92 + 0.08 * math.sin(t / 37.0))
        acc = np.clip(target - v, -2.5, 1.6)
        v = max(0.0, v + acc)
        s += v
        if s >= route.length_m:
            if loop:
                s -= route.length_m
            else:
                s = route.length_m
                v = 0.0
        out.append((s, v, acc))
    return out


def _canyon_mask(route, spec, rng, drone):
    """Seconds when buildings degrade the signal (city routes only)."""
    mask = np.zeros(spec.duration_s, dtype=float)
    if drone:
        return mask
    for _ in range(rng.integers(2, 5)):
        a = int(rng.uniform(0, spec.duration_s - 30))
        b = a + int(rng.uniform(12, 30))
        ramp = np.clip(np.minimum(np.arange(a, b) - a, b - np.arange(a, b)) / 4.0, 0, 1)
        mask[a:b] = np.maximum(mask[a:b], ramp)
    return mask


def simulate(spec: ScenarioSpec, start_time: datetime = DEFAULT_START):
    """Return a list of observation dicts for one scenario."""
    routes = load_routes()
    route = routes[spec.route]
    drone = route.profile == "small_uav"
    rng = np.random.default_rng(spec.seed)

    motion = _speed_trace(route, spec, rng, drone)
    canyon = _canyon_mask(route, spec, rng, drone)

    # receiver state
    pos_e, pos_n = AR1(rng, 1.1, 0.85), AR1(rng, 1.1, 0.85)
    sats_w = AR1(rng, 1.0, 0.97)
    cn0_w = AR1(rng, 0.6, 0.9)
    std_w = AR1(rng, 0.35, 0.9)
    pdop_w = AR1(rng, 0.08, 0.9)
    dop_w = AR1(rng, 25.0, 0.98)
    imu_bias = AR1(rng, 0.25, 0.995)
    drift_w = AR1(rng, 1.6, 0.95)
    clock_bias = float(rng.uniform(-5e4, 5e4))
    clock_drift = float(rng.uniform(15, 35))
    osnma_ready_s = int(rng.integers(35, 55))

    base_sats = 14.0 if drone else 12.0
    base_cn0 = 45.0 if drone else 41.5

    a0 = spec.attack_start_s
    a1 = a0 + spec.attack_duration_s
    perp_sign = 1.0 if rng.random() < 0.5 else -1.0
    push_brg = None  # spoofers push toward a fixed direction, chosen at capture
    teleport_brg = float(rng.uniform(40, 110))

    obs = []
    drift_e = drift_n = 0.0
    prev_heading = None
    jam_w = AR1(rng, 4.0, 0.9)
    for t, (s, v_true, acc_true) in enumerate(motion):
        tlat, tlon, brg = route.position_at(s)
        attack_on = spec.attack != "none" and a0 <= t < a1
        u = t - a0  # seconds into the attack
        c = canyon[t]

        # ---- honest observables ----
        sats = base_sats + sats_w.step() - 3.5 * c
        cn0 = base_cn0 + cn0_w.step() - 3.0 * c
        cn0_std = 4.4 + std_w.step() + 1.0 * c
        pr_res = abs(rng.normal(2.6, 0.9)) * (1 + 1.6 * c)
        doppler = 120.0 + dop_w.step() + 2.0 * v_true
        clock_drift += drift_w.step() * 0.15
        drift_meas_noise = rng.normal(0, 2.5)  # per-epoch noise of the receiver's drift estimate
        d_drift_extra = 0.0
        bias_jump = 0.0
        osnma = "pending" if t < osnma_ready_s else "verified"
        lat_err_e, lat_err_n = pos_e.step() * (1 + 1.5 * c), pos_n.step() * (1 + 1.5 * c)
        rep_lat, rep_lon = offset(tlat, tlon, lat_err_e, lat_err_n)
        rep_speed = max(0.0, v_true + rng.normal(0, 0.15))
        fix = True
        jam_ind = 18.0 + jam_w.step() + 6.0 * c

        # ---- attack overlays ----
        if attack_on:
            k = spec.attack
            if push_brg is None:
                push_brg = brg + 90 * perp_sign
            th = math.radians(push_brg)
            if k == "teleport":
                d = 8000.0
                bt = math.radians(teleport_brg)
                rep_lat, rep_lon = offset(rep_lat, rep_lon, d * math.sin(bt), d * math.cos(bt))
                cn0 += 7.0
                cn0_std = 1.2 + 0.2 * abs(std_w.v)
                sats = 10 + 0.3 * sats_w.v
                if u == 0:
                    d_drift_extra = 185.0
                else:
                    d_drift_extra = rng.normal(0, 9)
                pr_res += 1.5
                osnma = "unavailable"
            elif k in ("drift", "stealth_drift", "osnma_forgery", "drone_drift"):
                rate = {"drift": 0.9, "stealth_drift": 0.7, "osnma_forgery": 0.6, "drone_drift": 1.2}[k]
                # accumulate the push as a vector so the spoofed track stays smooth
                step = rate * min(1.0, (u + 1) / 30.0)
                drift_e += step * math.sin(th)
                drift_n += step * math.cos(th)
                rep_lat, rep_lon = offset(rep_lat, rep_lon, drift_e, drift_n)
                rep_speed = max(0.0, math.hypot(v_true, rate * min(1.0, (u + 1) / 30.0)) + rng.normal(0, 0.15))
                if k == "drift":
                    cn0 += 3.5
                    cn0_std = 2.1 + 0.3 * std_w.v
                    sats -= 2
                    d_drift_extra = 95.0 if u == 0 else rng.normal(0, 5)
                    pr_res += 1.2
                    osnma = "unavailable"
                elif k == "stealth_drift":
                    bias_jump = 260.0 if u == 0 else 0.0
                    if osnma == "pending":
                        osnma = "verified"
                elif k == "osnma_forgery":
                    cn0 += 4.0
                    cn0_std = 1.8 + 0.3 * std_w.v
                    d_drift_extra = 65.0 if u == 0 else rng.normal(0, 4)
                    osnma = "failed" if u >= 15 else "verified"
                else:  # drone_drift
                    cn0 += 5.0
                    cn0_std = 1.5 + 0.3 * std_w.v
                    d_drift_extra = 120.0 if u == 0 else rng.normal(0, 6)
                    osnma = "unavailable"
            elif k == "signal":
                cn0 += 8.0
                cn0_std = 1.0 + 0.2 * abs(std_w.v)
                sats -= 5.5
                pr_res += rng.uniform(5, 14)
                d_drift_extra = rng.normal(0, 25)
                osnma = "unavailable"
            elif k == "jamming":
                depth = min(16.0, 1.0 * (u + 1))
                jam_ind += min(200.0, 14.0 * (u + 1))
                cn0 -= depth
                cn0_std += depth * 0.15
                sats -= depth * 0.6
                pr_res += depth * 0.8
                osnma = "unavailable"
                if sats < 4.0:
                    fix = False

        sats_i = int(max(0, round(sats)))
        pdop = 1.0 + 7.5 / max(sats, 3.5) + pdop_w.step() + 0.4 * c
        if attack_on and spec.attack == "signal":
            pdop += 2.6
        clock_drift_reported = clock_drift + drift_meas_noise + d_drift_extra
        clock_bias += clock_drift_reported + bias_jump

        heading = brg if v_true > 0.5 or prev_heading is None else prev_heading
        heading = (heading + rng.normal(0, 1.5 if v_true > 2 else 8)) % 360
        prev_heading = heading

        imu_speed = max(0.0, v_true + imu_bias.step() * 0.4 + rng.normal(0, 0.25))
        o = {
            "seq": t,
            "t": (start_time + timedelta(seconds=t)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "lat": round(rep_lat, 7) if fix else None,
            "lon": round(rep_lon, 7) if fix else None,
            "speed_mps": round(rep_speed, 3) if fix else None,
            "heading_deg": round(heading, 2) if fix else None,
            "sats": sats_i,
            "cn0_mean_dbhz": round(cn0, 2) if sats_i > 0 else None,
            "cn0_std_dbhz": round(max(0.3, cn0_std), 2) if sats_i > 1 else None,
            "pdop": round(pdop, 2) if fix else None,
            "pr_residual_m": round(pr_res, 2) if fix else None,
            "doppler_mean_hz": round(doppler, 1) if sats_i > 0 else None,
            "clock_bias_ns": round(clock_bias, 1) if fix else None,
            "clock_drift_nsps": round(clock_drift_reported, 2) if fix else None,
            "jam_ind": int(np.clip(round(jam_ind), 0, 255)),
            "imu_speed_mps": round(imu_speed, 3),
            "imu_accel_mps2": round(acc_true + rng.normal(0, 0.15), 3),
            "osnma": osnma,
            "attack": bool(attack_on),
            "attack_kind": spec.attack if attack_on else None,
            "true_lat": round(tlat, 7),
            "true_lon": round(tlon, 7),
        }
        obs.append(o)
    return obs

