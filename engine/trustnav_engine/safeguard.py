"""Response layer: what the system does with a position it cannot trust.

Detection alone leaves the operator looking at a lie. This layer turns the
trust score into an action and a protected position, the way an intrusion
prevention system acts on what an intrusion detection system finds. It is
software only: nothing here touches the radio signal. What it protects is
every decision downstream of the receiver (dispatch, geofencing, billing,
flight control) by refusing to feed them a fix the engine does not believe.

Per observation:

  ACCEPT   the fix is present, trust is at or above the hold line (50) and
           no critical rule fired: the GNSS fix passes through unchanged.

  HOLD     otherwise the fix is rejected. The protected position is dead
           reckoned from the last accepted fix with the inertial/odometer
           speed, which a spoofer cannot touch. With an assigned route the
           estimate advances along the route (map matched), so the lateral
           error of the last accepted fix is dropped and only along-track
           odometer error accumulates. Without a route it continues on the
           last accepted heading.

  RELEASE  after `release_after_clean` consecutive acceptable observations,
           provided the returning fix lies within a tolerance of the estimate
           (a base distance plus a fraction of the distance travelled while
           held), so a spoofer cannot end the hold by looking clean while
           still far away. A long clean streak releases with a tolerance
           `rejoin_long_factor` times looser, with the discrepancy reported,
           because an odometer estimate drifts too; a fix that is still
           kilometres away stays refused, since no odometer drifts that far,
           and the operator is asked to verify. (Found on a real recording:
           without this bound a teleported fix that keeps moving consistently
           was taken back after sixty seconds.)

Recommended action, for the operator and for the fleet software:

  CONTINUE  use the fix.
  VERIFY    the position is an estimate: confirm by other means (driver
            call, camera, odometer) before acting on it.
  ISOLATE   trust is in the untrusted band or critical evidence fired: stop
            using this device's position for any decision. A drone holds or
            returns on inertial navigation; a vehicle's driver is contacted.
"""

import math

from .config import SafeguardSettings
from .geo import haversine_m, offset

ACTIONS = ("CONTINUE", "VERIFY", "ISOLATE")


class Safeguard:
    def __init__(self, route=None, settings: SafeguardSettings = SafeguardSettings()):
        self.route = route
        self.s = settings
        self.last = None        # last accepted fix: lat, lon, hdg, spd, s_route
        self.est = None         # protected estimate while holding: (lat, lon)
        self.est_s = None       # its arc-length position on the route
        self.held_s = 0.0
        self.travelled_m = 0.0  # distance dead reckoned since the hold began
        self.clean = 0
        self.prev_seq = None
        self.prev_clock = None

    # ---- public -------------------------------------------------------------------------------

    def update(self, frame, obs, clock=None):
        """Return the response dict for one scored frame. `clock` is the detector's trusted clock in seconds
        (the host's, or the receiver's while it runs forward): the time dead reckoning is stepped on, so a
        receiver that skips seconds, or one whose time is being rewritten, does not shorten the distance."""
        if clock is None:
            dt = 1.0 if self.prev_seq is None else max(0.0, float(frame["s"] - self.prev_seq))
        else:
            dt = 1.0 if self.prev_clock is None else max(0.0, float(clock - self.prev_clock))
            self.prev_clock = clock
        self.prev_seq = frame["s"]
        has_fix = bool(frame["fix"]) and frame["lat"] is not None and frame["lon"] is not None
        critical = any(r["severity"] == "CRITICAL" for r in frame["why"])
        acceptable = has_fix and frame["trust"] >= self.s.hold_below_trust and not critical
        action = self._action(frame, critical, acceptable)

        if self.est is not None:                                   # currently holding
            self._advance(frame, obs, dt)
            self.held_s += dt
            if acceptable:
                self.clean += 1
                gap = haversine_m(frame["lat"], frame["lon"], *self.est)
                tol = self.s.rejoin_base_m + self.s.rejoin_frac * self.travelled_m
                long_ok = self.clean >= self.s.release_after_long_clean and gap <= self.s.rejoin_long_factor * tol
                if (self.clean >= self.s.release_after_clean and gap <= tol) or long_ok:
                    held = self.held_s
                    self._accept(frame)
                    return self._resp("accept", frame["lat"], frame["lon"], 0.0, action, gap, "gnss", rejoined_after_s=held)
            else:
                self.clean = 0
            gap = haversine_m(frame["lat"], frame["lon"], *self.est) if has_fix else None
            return self._resp("hold", self.est[0], self.est[1], self.held_s, action, gap, self._source())

        if acceptable:
            self._accept(frame)
            return self._resp("accept", frame["lat"], frame["lon"], 0.0, action, None, "gnss")

        if self.last is None:                                      # nothing trusted yet to reckon from
            return self._resp("none", None, None, 0.0, action, None, None)

        # start a hold from the last accepted fix, one step on
        self.est = (self.last["lat"], self.last["lon"])
        self.est_s = self.last["s_route"]
        self.held_s = dt
        self.travelled_m = 0.0
        self.clean = 0
        self._advance(frame, obs, dt)
        gap = haversine_m(frame["lat"], frame["lon"], *self.est) if has_fix else None
        return self._resp("hold", self.est[0], self.est[1], self.held_s, action, gap, self._source())

    # ---- internals ----------------------------------------------------------------------------

    def _action(self, frame, critical, acceptable):
        if acceptable:
            return "CONTINUE"
        if critical or frame["trust"] < self.s.isolate_below_trust:
            return "ISOLATE"
        return "VERIFY"

    def _accept(self, frame):
        s_route = None
        if self.route is not None:
            # direction and continuity break ties where the route doubles back on itself
            near = self.est_s if self.est_s is not None else (self.last["s_route"] if self.last else None)
            s_route = self.route.project(frame["lat"], frame["lon"], heading=frame.get("hdg"), near_s=near)[0]
        self.last = {"lat": frame["lat"], "lon": frame["lon"], "hdg": frame.get("hdg"), "spd": frame.get("spd"), "s_route": s_route}
        self.est, self.est_s = None, None
        self.held_s, self.travelled_m, self.clean = 0.0, 0.0, 0

    def _speed(self, frame, obs):
        v = obs.get("imu_speed_mps")
        if v is None:
            v = self.last.get("spd") if self.last else None
        return max(0.0, float(v or 0.0))

    def _advance(self, frame, obs, dt):
        d = self._speed(frame, obs) * dt
        self.travelled_m += d
        if self.route is not None and self.est_s is not None:
            s = self.est_s + d
            if self.route.is_loop and self.route.length_m > 0:
                s %= self.route.length_m
            else:
                s = min(s, self.route.length_m)
            self.est_s = s
            lat, lon, _ = self.route.position_at(s)
            self.est = (lat, lon)
        else:
            h = math.radians(float(self.last.get("hdg") or 0.0))
            self.est = offset(self.est[0], self.est[1], d * math.sin(h), d * math.cos(h))

    def _source(self):
        return "route_odometer" if self.route is not None and self.est_s is not None else "heading_odometer"

    @staticmethod
    def _resp(mode, lat, lon, held_s, action, gap_m, source, rejoined_after_s=None):
        out = {
            "mode": mode,
            "lat": None if lat is None else round(lat, 7),
            "lon": None if lon is None else round(lon, 7),
            "held_s": round(held_s, 1),
            "action": action,
            "gap_m": None if gap_m is None else round(gap_m, 1),
            "source": source,
        }
        if rejoined_after_s is not None:
            out["rejoined_after_s"] = round(rejoined_after_s, 1)
        return out
