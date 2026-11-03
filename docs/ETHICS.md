# Safety, legal and ethics

**Nothing is transmitted.** Every jamming, spoofing and forgery attack in this project exists only as software: the simulator produces the observations a receiver would report, and the recorded scenarios replay them. Transmitting on the GNSS bands is illegal in France (the ANFR investigates interference cases and the law provides for up to six months' imprisonment and a 30,000 EUR fine), and a jammer in a car affects everyone around it, as the Nantes and Lyon airport cases showed. Real attack testing will use public recordings (Jammertest, TEXBAT) or a shielded laboratory with a licence, never the open air.

**The receiver only listens.** The Phase 2 hardware is a receive-only GNSS antenna and receiver, which needs no licence and emits nothing.

**Personal data.** The demo tracks seven simulated platforms; no personal data is involved. A real deployment tracks vehicles, and therefore the people driving them, so the GDPR applies: the purpose is to detect attacks on the positioning, not to monitor drivers; frames should be kept only as long as needed (the demo database prunes live frames after three days); access is controlled (public read of synthetic data only, writes through a token, presenter actions behind a passcode); and operators should tell drivers what is collected and why.

**Security of the system itself.** Secrets are never in the repository; the ingest token is stored only as a SHA-256 hash and the presenter passcode as a bcrypt hash with rate limiting; row-level security limits the browser to reading. The response layer is designed so that a spoofer cannot end a hold simply by looking clean (the returning fix must rejoin the estimate).

**Honest claims.** The trust score is a research indicator, not a certified integrity figure, and the reported numbers come from one simulator. TrustNav is not for aviation, maritime or other safety-critical use. Its limits are listed in the Method page of the console and in the Results section.

**Open data and attribution.** Map data © OpenStreetMap contributors, basemaps © CARTO, road routes computed with OSRM. Sources for the market comparison are cited in that section.
