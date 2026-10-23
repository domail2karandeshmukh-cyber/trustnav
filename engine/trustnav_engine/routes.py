"""Routes: real road geometry around Angers plus generated drone missions.

Road routes were computed with OSRM on OpenStreetMap data and stored in
data/routes.json. Each route plays one role in evaluation, so no route is
used for both training and reporting:

    train       fits the Isolation Forest (normal driving only)
    validation  chooses fusion weights
    heldout     produces every reported number and the demo replays
"""

import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from .geo import LocalFrame, haversine_m

DATA_DIR = Path(__file__).parent / "data"


class Route:
    """A polyline the platform is expected to follow."""

    def __init__(self, slug, name, points, role, profile="generic_road_vehicle", source=""):
        self.slug = slug
        self.name = name
        self.role = role
        self.profile = profile
        self.source = source
        self.points = [(float(a), float(b)) for a, b in points]
        lat = np.array([p[0] for p in self.points])
        lon = np.array([p[1] for p in self.points])
        self.frame = LocalFrame(float(lat.mean()), float(lon.mean()))
        x, y = self.frame.to_xy(lat, lon)
        self.x, self.y = np.asarray(x, float), np.asarray(y, float)
        seg = np.hypot(np.diff(self.x), np.diff(self.y))
        self.cum = np.concatenate([[0.0], np.cumsum(seg)])
        self.length_m = float(self.cum[-1])

    def position_at(self, s):
        """Point and travel bearing at distance s along the route."""
        s = float(np.clip(s, 0.0, self.length_m))
        i = int(np.searchsorted(self.cum, s, side="right") - 1)
        i = min(max(i, 0), len(self.x) - 2)
        seg_len = self.cum[i + 1] - self.cum[i]
        f = 0.0 if seg_len <= 0 else (s - self.cum[i]) / seg_len
        x = self.x[i] + f * (self.x[i + 1] - self.x[i])
        y = self.y[i] + f * (self.y[i + 1] - self.y[i])
        brg = (math.degrees(math.atan2(self.x[i + 1] - self.x[i], self.y[i + 1] - self.y[i])) + 360) % 360
        lat, lon = self.frame.to_latlon(x, y)
        return float(lat), float(lon), brg

    def curvature_speed_limits(self, cruise_mps, lateral_accel_mps2, step_m=5.0, look_m=25.0):
        """Comfortable speed at every step_m along the route, slowing for bends."""
        s_grid = np.arange(0.0, self.length_m + step_m, step_m)
        brg = np.array([self.position_at(s)[2] for s in s_grid])
        limits = np.full_like(s_grid, cruise_mps)
        n = int(look_m / step_m)
        for k in range(len(s_grid)):
            j = min(k + n, len(s_grid) - 1)
            turn = abs((brg[j] - brg[k] + 180) % 360 - 180)
            if turn > 1e-3:
                radius = (look_m) / math.radians(turn)
                limits[k] = min(cruise_mps, math.sqrt(lateral_accel_mps2 * radius))
        return s_grid, np.maximum(limits, 1.0)

    def distance_to(self, lat, lon):
        """Shortest distance in metres from a fix to the route polyline."""
        px, py = self.frame.to_xy(lat, lon)
        x0, y0, x1, y1 = self.x[:-1], self.y[:-1], self.x[1:], self.y[1:]
        dx, dy = x1 - x0, y1 - y0
        den = dx * dx + dy * dy
        den[den == 0] = 1e-9
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / den, 0.0, 1.0)
        cx, cy = x0 + t * dx, y0 + t * dy
        return float(np.min(np.hypot(px - cx, py - cy)))

    def to_dict(self, max_points=None):
        pts = self.points
        if max_points and len(pts) > max_points:
            idx = np.linspace(0, len(pts) - 1, max_points).astype(int)
            pts = [pts[i] for i in idx]
        return {
            "slug": self.slug,
            "name": self.name,
            "role": self.role,
            "profile": self.profile,
            "length_m": round(self.length_m, 1),
            "points": [[round(a, 6), round(b, 6)] for a, b in pts],
        }


def drone_survey_points(lat0, lon0, lanes=6, lane_length_m=420.0, spacing_m=45.0, heading_deg=20.0):
    """A lawnmower survey pattern, the classic drone mapping mission."""
    frame = LocalFrame(lat0, lon0)
    pts_xy = []
    for k in range(lanes):
        y = (k - (lanes - 1) / 2) * spacing_m
        xs = np.linspace(-lane_length_m / 2, lane_length_m / 2, 12)
        if k % 2:
            xs = xs[::-1]
        pts_xy.extend((x, y) for x in xs)
        if k < lanes - 1:
            # semicircular turn into the next lane
            cx = xs[-1]
            cy = y + spacing_m / 2
            side = 1 if k % 2 == 0 else -1
            for a in np.linspace(-90, 90, 9)[1:-1]:
                r = spacing_m / 2
                pts_xy.append((cx + side * r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a))))
    th = math.radians(heading_deg)
    out = []
    for x, y in pts_xy:
        xr = x * math.cos(th) - y * math.sin(th)
        yr = x * math.sin(th) + y * math.cos(th)
        lat, lon = frame.to_latlon(xr, yr)
        out.append((float(lat), float(lon)))
    return out


DRONE_MISSIONS = {
    "drone_survey_saint_sylvain": ("train", "Drone survey, fields north of Angers", 47.5260, -0.5650, 15.0),
    "drone_survey_trelaze": ("train", "Drone survey, Trélazé east", 47.4430, -0.4800, -30.0),
    "drone_survey_avrille": ("validation", "Drone survey, Avrillé west", 47.5050, -0.6100, 60.0),
    "drone_survey_lac_de_maine": ("heldout", "Drone survey, Lac de Maine", 47.4560, -0.5920, 25.0),
}


def chaikin(points, iterations=2):
    """Round sharp polyline corners so simulated turns take a few seconds,
    as real ones do, instead of happening inside a single epoch."""
    pts = list(points)
    closed = haversine_m(*pts[0], *pts[-1]) < 1.0
    for _ in range(iterations):
        out = [pts[0]]
        for (a1, b1), (a2, b2) in zip(pts[:-1], pts[1:]):
            out.append((0.75 * a1 + 0.25 * a2, 0.75 * b1 + 0.25 * b2))
            out.append((0.25 * a1 + 0.75 * a2, 0.25 * b1 + 0.75 * b2))
        out.append(pts[-1])
        pts = out
    if closed:
        pts[-1] = pts[0]
    return pts


@lru_cache(maxsize=None)
def load_routes():
    """All routes keyed by slug."""
    raw = json.loads((DATA_DIR / "routes.json").read_text())
    routes = {
        slug: Route(slug, r["name"], chaikin(r["points"]), r["role"], "generic_road_vehicle", r.get("source", ""))
        for slug, r in raw.items()
    }
    for slug, (role, name, lat, lon, hdg) in DRONE_MISSIONS.items():
        routes[slug] = Route(slug, name, drone_survey_points(lat, lon, heading_deg=hdg), role, "small_uav", "generated")
    return routes


def routes_by_role(role):
    return [r for r in load_routes().values() if r.role == role]
