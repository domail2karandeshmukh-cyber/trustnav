"""TrustNav detection engine.

Turns a stream of GNSS observations into a per-fix trust score (0-100) with
the evidence that explains it. Three layers work together:

1. Rules: deterministic physical and signal checks with named thresholds.
2. Model: an Isolation Forest trained on normal observations only.
3. Fusion: a noisy-OR combination of both risks; trust = 100 - risk.

Galileo OSNMA authentication status is evidence for the rules layer.
"""

__version__ = "2.0.0"
