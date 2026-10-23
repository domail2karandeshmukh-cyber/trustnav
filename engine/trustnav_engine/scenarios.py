"""Scenario catalogue. Routes and seeds keep the three splits apart."""

from .simulator import ScenarioSpec

ATTACK_DESCRIPTIONS = {
    "none": "Clean drive with traffic stops, cornering and urban-canyon segments. Expected: trust stays high, no incident.",
    "teleport": "A GPS-only spoofer captures the receiver and moves the fix 8 km in one epoch. Galileo authentication disappears.",
    "drift": "A spoofer slowly pulls the position sideways at under 1 m/s. Its signals are stronger and more uniform than real satellites.",
    "signal": "Spoofer onset: C/N0 jumps and becomes unnaturally uniform, satellites drop out, residuals and PDOP rise. The position barely moves.",
    "stealth_drift": "Relay-style attack: signals look clean and OSNMA still verifies, but the position drifts away from the road. Only motion evidence can catch it.",
    "osnma_forgery": "A spoofer forges Galileo navigation data. OSNMA tag verification fails within seconds of capture.",
    "jamming": "Broadband noise drowns the signal. C/N0 collapses, satellites are lost and the fix disappears, then the receiver recovers.",
    "drone_drift": "A spoofer pushes a survey drone off its mission plan by about 1 m/s while its own signals dominate.",
}


def training_specs():
    """Normal operation only: the model must never see an attack."""
    specs = []
    for route in ("loire_road", "maine_road", "briollay_loop", "belle_beille_loop", "roseraie_loop"):
        for seed in range(8 if "loop" in route and route != "briollay_loop" else 5):
            specs.append(ScenarioSpec(f"train_{route}_{seed}", f"Training: {route}", route, "none",
                                      seed=1000 + seed * 17 + len(route), duration_s=420,
                                      start_offset_m=seed * 900.0))
    for route in ("drone_survey_saint_sylvain", "drone_survey_trelaze"):
        for seed in range(5):
            specs.append(ScenarioSpec(f"train_{route}_{seed}", f"Training: {route}", route, "none",
                                      seed=2000 + seed * 13 + len(route), duration_s=360,
                                      start_offset_m=seed * 400.0, device_id="UAV-01"))
    return specs


def validation_specs():
    """Normal and attacked runs on validation routes; used only to pick fusion weights."""
    specs = []
    kinds = ["none", "none", "teleport", "drift", "signal", "stealth_drift", "osnma_forgery", "jamming"]
    for i, k in enumerate(kinds):
        for route in ("bouchemaine_loop", "doutre_saint_serge_loop"):
            specs.append(ScenarioSpec(f"val_{route}_{k}_{i}", f"Validation: {k}", route, k, seed=3000 + i * 31 + len(route),
                                      duration_s=300, attack_start_s=100,
                                      attack_duration_s=100 if k == "jamming" else 10_000,
                                      start_offset_m=i * 700.0))
    for i, k in enumerate(["none", "drone_drift"]):
        specs.append(ScenarioSpec(f"val_drone_{k}", f"Validation: drone {k}", "drone_survey_avrille", k,
                                  seed=3500 + i, duration_s=300, attack_start_s=100, device_id="UAV-01"))
    return specs


def heldout_specs():
    """The demo catalogue. Every reported number comes from these."""
    c = "angers_centre_loop"
    m = "angers_monplaisir_loop"
    d = "drone_survey_lac_de_maine"
    rows = [
        ("normal_angers_centre", "Normal drive: Angers centre loop", c, "none", 101, 420, "VEH-01"),
        ("normal_angers_east", "Normal drive: Angers east loop", m, "none", 102, 420, "VEH-02"),
        ("teleport_spoof", "Teleport spoof: 8 km position jump", c, "teleport", 103, 360, "VEH-03"),
        ("gradual_drift_spoof", "Gradual drift spoof: slow lateral takeover", m, "drift", 104, 380, "VEH-04"),
        ("signal_anomaly", "Signal anomaly: spoofer onset", c, "signal", 105, 360, "VEH-05"),
        ("stealth_drift_spoof", "Stealth drift: clean signal, OSNMA verified, wrong position", m, "stealth_drift", 106, 400, "VEH-06"),
        ("osnma_forgery", "Galileo OSNMA forgery: authentication fails", c, "osnma_forgery", 107, 360, "VEH-07"),
        ("jamming_recovery", "Jamming: fix lost, then recovered", m, "jamming", 108, 380, "VEH-08"),
        ("drone_normal", "Drone survey: Lac de Maine, normal", d, "none", 109, 360, "UAV-01"),
        ("drone_drift_spoof", "Drone survey: spoofed off mission", d, "drone_drift", 110, 360, "UAV-02"),
    ]
    specs = []
    for slug, name, route, kind, seed, dur, dev in rows:
        specs.append(ScenarioSpec(slug, name, route, kind, seed=seed, duration_s=dur, attack_start_s=130,
                                  attack_duration_s=110 if kind == "jamming" else 10_000,
                                  description=ATTACK_DESCRIPTIONS[kind], device_id=dev,
                                  start_offset_m=(seed % 5) * 600.0))
    return specs


FLEET_DEVICES = [
    # id, name, kind, route, attack, attack_start, attack_duration, seed, start offset (m)
    ("VEH-01", "Delivery van 01", "vehicle", "angers_centre_loop", "none", None, None, 201, 0.0),
    ("VEH-02", "Delivery van 02", "vehicle", "angers_monplaisir_loop", "none", None, None, 202, 1500.0),
    ("VEH-03", "Delivery van 03", "vehicle", "angers_centre_loop", "teleport", 95, 10_000, 203, 2600.0),
    ("VEH-04", "Delivery van 04", "vehicle", "angers_monplaisir_loop", "osnma_forgery", 150, 10_000, 204, 5200.0),
    ("VEH-05", "Delivery van 05", "vehicle", "angers_centre_loop", "stealth_drift", 60, 10_000, 205, 4200.0),
    ("VEH-06", "Delivery van 06", "vehicle", "angers_monplaisir_loop", "jamming", 215, 85, 206, 7600.0),
    ("UAV-01", "Survey drone 01", "drone", "drone_survey_lac_de_maine", "drone_drift", 250, 10_000, 207, 0.0),
]


def fleet_specs(duration_s=420):
    """The live demo fleet: seven platforms over Angers, attacks staggered so
    the audience sees them arrive one after another."""
    specs = []
    for dev, name, kind, route, attack, a0, adur, seed, off in FLEET_DEVICES:
        specs.append(ScenarioSpec(f"fleet_{dev.lower()}", name, route, attack, seed=seed, duration_s=duration_s,
                                  attack_start_s=a0 or 0, attack_duration_s=adur or 10_000,
                                  description=ATTACK_DESCRIPTIONS[attack], device_id=dev, start_offset_m=off))
    return specs
