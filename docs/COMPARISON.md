# How TrustNav differs from what exists today

The tutor's question: *why is this different from what is already on the market?*

Short answer: existing tools either live **inside one receiver** and output a flag with no explanation, or they are **fixed monitoring stations** for sites and countries. None of the ones we found gives a fleet operator a per-vehicle, per-second, explained trust score with a response. That gap is where TrustNav sits. The sections below say what each existing approach does, with sources, and then what TrustNav adds and what it does not.

Facts below were checked on 3 November 2026 against the sources listed. Where a vendor does not publish something (prices, internals), we say so rather than guess.

## 1. Detection inside the receiver chip

**u-blox** (the chips in most trackers, drones and cheap USB receivers) report a *spoofing state* (0 unknown, 1 none, 2 indicated, 3 multiple indications) and a *jamming state* to the host. Newer firmware (ZED-F9P HPG 1.50, July 2024) adds a jamming log, Galileo OSNMA and per-band flags.
- Runs inside the chip. Covers jamming and spoofing. One receiver only. No explanation: the output is a state code, and u-blox notes that state 1 "does not prove the receiver is not spoofed". The method depends on first locking to genuine signals; a receiver that starts inside a spoofed field may never notice. At Jammertest 2025 a u-blox receiver raised both jamming *and* spoofing flags during a jamming-only run.
- Typical boards: NEO-M9N about 60 to 70 EUR, ZED-F9P about 190 to 280 EUR (third-party shops).

**Septentrio AIM+** is a similar built-in layer on higher-end survey and timing receivers: notch filters against jammers, a spectrum view, spoofing and meaconing flags from timing and cross-constellation inconsistencies, OSNMA in the top tier. One receiver, firmware-level, no fleet view, prices not published.

**What this means for TrustNav.** These flags are *inputs*, not competitors. The receiver adapter (`engine/trustnav_engine/receiver.py`) reads the u-blox jamming indicator and spoofing state and passes them to the engine, which combines them with motion, route and signal evidence and explains the result. A receiver flag on its own tells the operator nothing about *which* vehicle, *since when*, *how far off* or *what to do*.

## 2. Fixed monitoring stations

**GPSPatron** sells probes (1 to 3 antennas, rack-mounted) that stream raw observables to a cloud that classifies jamming and spoofing types, with charts and a claimed 0.6 s detection latency. It is designed for sites and nationwide networks (1,000+ probes claimed); the three-antenna probe needs at least 1 m of antenna separation. Prices on request.

**Safran (Orolia) BroadShield** is a software library sold inside time servers, or embedded into a customer's product with vendor support, detecting jamming types and spoofing indicators (position and time jumps, data anomalies). No fleet layer is described.

**What this means for TrustNav.** Fixed probes protect a *place* (a port, an airport, a data centre). TrustNav protects a *moving platform*, with no extra antenna, using the receiver the vehicle already has.

## 3. Hardware that mitigates jamming

**infiniDome GPSdome / OtoSphere** are boxes placed between the antenna and the receiver that null-steer jammers using two or more antennas (about 20 dB attenuation for GPSdome, dual band in GPSdome 2). They are primarily jamming *mitigation*; the spoofing claim appears only in an older fleet demonstration. Prices not published.

**What this means for TrustNav.** Nothing in software can remove a jammer from the air. TrustNav is explicit about this: during jamming it detects, keeps an estimated position from the odometer, and tells the operator. A null-steering antenna is a complementary purchase, not an alternative.

## 4. Software-only spoofing detection products

**Regulus Cyber Pyramid GNSS** (2019 to 2020) was a software-only spoofing detector with machine learning, integrated into Harman's automotive security product. The company still exists but now markets counter-drone products; Pyramid GNSS no longer appears on its site, and we found no public details of its method or explanations.

**Fleet telematics platforms.** Geotab's newer GO devices log a `GpsJammingDetected` event when the GPS module's own jamming detector fires; the operator can build a report on it. We found no spoofing detection claim from Geotab, and nothing at all about jamming or spoofing on Samsara's or Webfleet's sites. Navixy exposes a "GPS jamming" rule that depends on the tracker's own flag.

**What this means for TrustNav.** The fleet software market mostly *relays the receiver's own flag*, when it relays anything. There is no per-second trust score, no explanation and no response layer in what we could find.

## 5. Galileo OSNMA (authentication)

Galileo OSNMA has been operational since 24 July 2025 (EU Commission / EUSPA). It signs the Galileo navigation data so a receiver can tell authentic Galileo messages from forged ones; it is mandatory in smart tachographs on new EU trucks and buses from December 2025.

What it does not do, in the EU GNSS Service Centre's own words: it gives "no protection against jamming" and "does not prevent spoofing", it only lets a receiver flag unauthenticated data. GPS data is not authenticated by it. Researchers have shown replay (meaconing) attacks that pass OSNMA on real receivers (Wang et al., 2025).

**What this means for TrustNav.** OSNMA is one of the three evidence layers, not the whole answer. The stealth-drift scenario exists precisely to show a relay attack where OSNMA still verifies and only the motion evidence catches the attack.

## 6. Aviation interference maps

GPSJam and Flightradar24 colour the world by how many aircraft report degraded navigation accuracy (ADS-B NACp or NIC). They show *where* interference is happening at country scale, with a 6 to 24 hour refresh, only where aircraft fly, and they cannot tell jamming from spoofing. OpsGroup counted about 1,500 flights per day affected by spoofing in 2024.

**What this means for TrustNav.** These maps say "something is wrong in this region". TrustNav says "this van, since 16:08, 8 km off, authentication failed, hold its position". Different scale, different user.

## 7. Academic approaches

Recent papers use machine learning on receiver observables (C/N0, pseudorange residuals, Doppler, clock), mostly trained and tested on the TEXBAT recordings: for example an LSTM / VAE network (Tang and Qin, 2025, F1 96.9 % on TEXBAT), a convolutional VAE trained on clean data only (Iqbal et al., about 100 % true positives on easy sets, 89 % on the hardest), and a random forest on multi-parameter features (Li et al., IEEE Access 2025, above 97 %). A Stanford study (Kriezis et al., ION ITM 2025) ran rule-based checks on real spoofing in the eastern Mediterranean with a 200 EUR u-blox ZED-F9P: C/N0, residuals and clock drift were useful, AGC and Doppler were not, and the standard aviation MOPS algorithm scored 94 % on one receiver but under 13 % on another.

**What this means for TrustNav.** TrustNav is in the same family (rules plus a model trained on normal data only, on receiver observables) with three differences: it is a *system*, not a classifier, with incidents, explanations and a response; it adds the *route* and *odometer* as evidence the receiver cannot provide; and it reports *per-second trust* rather than a binary verdict. The Stanford result is also a warning we take seriously: thresholds tuned on one receiver can fail on another, which is why the real-receiver phase starts by recording normal drives and re-calibrating.

## Side by side

| | Receiver flags (u-blox, Septentrio) | Fixed probes (GPSPatron) | Anti-jam hardware (infiniDome) | Fleet telematics (Geotab etc.) | OSNMA | Aviation maps | **TrustNav** |
|---|---|---|---|---|---|---|---|
| Protects | one receiver | a site or region | one receiver | the fleet screen | Galileo data | a region | **each moving platform** |
| Detects | jamming + spoofing | jamming + spoofing | jamming (mitigates) | relays receiver jamming flag | forged Galileo data | degraded accuracy | **jamming + spoofing + forgery** |
| Per-second score | no (state code) | probability | no | no | no | no (daily / 6 h) | **yes, 0 to 100** |
| Explains why | no | partly (charts) | no | no | n/a | no | **yes, in words with values** |
| Uses route / odometer | no | no | no | no | no | no | **yes** |
| Responds | no | alerts | yes (RF) | report | flag | no | **refuses the fix, estimates, recommends action** |
| Extra hardware | none | probe + 1 to 3 antennas | 2+ antennas | none | OSNMA-capable receiver | none | **none** |
| Fleet view | no | network of sites | no | yes | no | yes | **yes** |
| Status | shipping | shipping | shipping | shipping | operational | live | **prototype; simulated data and replays of real recordings** |

## What TrustNav does not do (yet)

- It has not been tested **live on its own receiver**. The detection table comes from one simulator. It has been replayed on public recordings: a clean real drive, and real jamming and spoofing from Jammertest 2024 (two devices, two days), where the first version missed a spoofed phone until receiver time was checked against the host clock. The products above are tested at Jammertest every year, on many receivers. Phase 2 (see `ROADMAP.md`) is the live test.
- It cannot **remove** a jammer or a spoofer from the air. Only antenna hardware mitigates at RF level.
- It does not do **signal-level** analysis (spectrum, correlator shapes, antenna arrays). It works at the level of what a receiver reports, so a very careful spoofer that keeps every observable consistent and follows the road is hard to catch; the model layer and the odometer comparison are the defence, and a second antenna would be the next step.
- Its OSNMA status is **simulated**; a real implementation needs raw Galileo pages and an OSNMA library.

## Sources

- u-blox: ZED-F9P HPG 1.50 release notes (https://content.u-blox.com/sites/default/files/documents/ZED-F9P_FW100HPG150_RN_UBXDOC-963802114-12826.pdf); NEO-M9N product summary; Jammertest 2025 blog (https://www.u-blox.com/en/blogs/tech/gnss-jamming-spoofing-detection-jammertest-2025-andoya); GPSPatron u-blox test (https://gpspatron.com/ublox-m8t-gps-spoofing-test); gnss.store prices.
- Septentrio AIM+: https://www.septentrio.com/en/learn-more/advanced-positioning-technology/aim-spoofing-protection and the Jammertest 2025 results page.
- GPSPatron: https://gpspatron.com/detecting-gnss-threats/ , https://gpspatron.com/gp-cloud , GP-Probe TGE2 datasheet.
- infiniDome: Honeywell GPSdome page; GPS World on GPSdome 2 (https://www.gpsworld.com/infinidome-releases-gpsdome-2-dual-band-anti-jamming-technology/).
- Regulus Cyber: Inside GNSS (https://insidegnss.com/?p=181662), GPS World, CB Insights, regulus.com.
- Safran BroadShield: https://safran-navigation-timing.com/product/broadshield
- Galileo OSNMA: EUSPA (https://www.euspa.europa.eu/newsroom-events/news/testing-operations-galileo-osnma-service-now-available-users), GSC FAQ (https://www.gsc-europa.eu/node/7832), Wang et al. 2025 (https://arxiv.org/html/2501.09246v1).
- Geotab: https://www.geotab.com/blog/combating-gps-jammers/ ; Navixy: https://navixy.com/docs/user/guide/events-and-notifications/device-positioning/gps-jamming
- Aviation maps: https://gpsjam.org/faq/ , https://www.flightradar24.com/data/gps-jamming , OpsGroup report (https://ops.group/blog/gps-spoofing-final-report/).
- Papers: Tang and Qin, APSIPA ASC 2025; Kriezis et al., ION ITM 2025 (https://web.stanford.edu/group/scpnt/gpslab/pubs/papers/Kreizis_ION_ITM_2025_Real_World_Spoofing_Detection.pdf); Li et al., IEEE Access 2025, doi 10.1109/ACCESS.2025.3553475; Iqbal, Aman, Sikdar (https://www.ece.nus.edu.sg/stfpage/bsikdar/papers/ccnc_25b.pdf); Bhuiyan et al., GPS Solutions 2026 (https://doi.org/10.1007/s10291-026-02102-z).
- Datasets: TEXBAT (https://radionavlab.ae.utexas.edu/texbat), Jammertest plan (https://github.com/NPRA/jammertest-plan), FGI Jammertest 2023 recordings (https://etsin.fairdata.fi/dataset/2eee8cfd-db00-4e46-bd62-d7632c09c700), VAARA, University of Vaasa, Jammertest 2024 (https://github.com/UniVaasaDigiEco/VAARA), Google gps-measurement-tools (https://github.com/google/gps-measurement-tools).
- Incidents: Inside GNSS on the Newark GBAS case; ANFR interference guide 2024 (https://anfr.fr/fileadmin/mediatheque/documents/brouillage/ANFR-DGITM_-_Guide_Brouillage_VD_-_2024.pdf); trans.info on the Lyon airport case; EU Council note ST-9188-2025 on Baltic interference.
