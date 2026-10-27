# MediaGuardSports Location & Map Implementation Audit

**Author:** FixProof Forensic Engineering Team  
**Date:** October 28, 2026  
**Reference Project:** `~/projects/mediaguardsports` (**Read-Only Reference**)  
**Target Projects:** `~/projects/FIXPROOF` (NVIDIA) and `~/projects/fixproof-muse-hackathon` (Meta)  
**Status:** Complete Audit & Technical Recommendation

---

## 1. Executive Summary

This audit investigates the geographical location detection and map visualization capabilities in the reference repository `~/projects/mediaguardsports`.

### Key Finding:
**MediaGuardSports does not perform GPS extraction from video containers, does not execute visual landmark inference, and does not perform network/IP geolocation.** 

Instead, its map visualization is driven by an OSINT YouTube channel metadata lookup via `yt-dlp` (`info.get("channel_country")`), which maps country ISO codes to static geographic country centroid coordinates. Crucially, when `channel_country` is unavailable or not recognized—which is the case for the majority of unverified public video uploads—**the backend explicitly selects a country at random using Python's `random.choice()`**.

Consequently, the map in MediaGuardSports is a visual synthetic demonstration rather than an empirical or forensic geolocation engine. FixProof must **not** copy this behavior or fabricate geographic pins, as doing so would compromise forensic integrity in enterprise copyright operations.

---

## 2. File & Component Traceability

The reference map implementation spans the following frontend and backend modules:

| Subsystem | Exact File Path | Role & Responsibilities |
|---|---|---|
| **Frontend Map UI** | `Frontend/src/components/dashboard/ThreatMap.jsx` | React Leaflet (`react-leaflet` v4 / Leaflet v1.9) map rendering CartoDB dark tiles (`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`), pulsing HTML markers, connection arcs (`Polyline`), and HUD overlays. |
| **Frontend Container** | `Frontend/src/components/dashboard/ThreatHunter.jsx:342-351` | Embeds `<ThreatMap />` in a 2:1 split-column grid next to the live terminal event feed. |
| **Backend OSINT Crawler** | `Backend/agents/spider.py:18-49, 101-174` | Defines static country centroids dictionary, queries `yt-dlp` for metadata, executes random country assignment fallback, and outputs `spider_payload.json`. |
| **Backend Controller** | `Backend/server/controllers/swarmController.js:68-76, 110-138` | Stores coordinates in MongoDB `HuntJob` and `Incident` records; broadcasts `spider:complete` and `sentinel:threat_found` WebSocket events. |
| **Backend Controller** | `Backend/server/controllers/sentinelController.js:28-55, 115-136` | Handles batch Sentinel scans and passes coordinates along into the `Incident` document. |
| **Database Schemas** | `Backend/server/models/Incident.js:14`, `Backend/server/models/HuntJob.js:10` | Mongoose schema definitions: `coordinates: { lat: Number, lng: Number }`. |

---

## 3. Detailed Answers to Audit Questions

### 1. Exact frontend components and backend files responsible for the map
- **Frontend:**
  - `Frontend/src/components/dashboard/ThreatMap.jsx`: The Leaflet map component rendering markers, ping pulses (`mapPing` keyframes), distance circles (`Circle`), and connecting origin-to-suspect lines (`Polyline`).
  - `Frontend/src/components/dashboard/ThreatHunter.jsx`: Imports and embeds `<ThreatMap />`.
- **Backend:**
  - `Backend/agents/spider.py`: The Python worker that defines `COUNTRY_CENTROIDS` (lines 18–49) and generates coordinates in `crawl()` (lines 113, 146, 160).
  - `Backend/server/controllers/swarmController.js`: Express controller coordinating phases and emitting coordinate payloads via Socket.io.
  - `Backend/server/models/Incident.js`: MongoDB model storing coordinates.

---

### 2. API endpoints and data structures supplying coordinates
- **Data Flow:**
  1. The client invokes `POST /api/swarm/hunt` or `POST /api/sentinel/scan/batch`.
  2. `swarmController.js` invokes Python's `spider.py` CLI or FastAPI endpoint.
  3. `spider.py` returns `map_payload`:
     ```json
     {
       "official_source": {
         "node_id": "official_01",
         "title": "Official Title",
         "url": "https://...",
         "country": "US",
         "coordinates": { "lat": 37.0902, "lng": -95.7129 }
       },
       "threat_nodes": [
         {
           "title": "Suspect Title",
           "platform": "YouTube",
           "url": "https://...",
           "country": "IN",
           "coordinates": { "lat": 20.5937, "lng": 78.9629 }
         }
       ]
     }
     ```
  4. The WebSocket server emits `spider:complete` with `threat_nodes` and `official_source`.
  5. The frontend `ThreatMap.jsx` listens to `eventLog` from SocketContext and maps `node.coordinates.lat` and `node.coordinates.lng`.

---

### 3. Coordinate origin: Where do the numbers actually come from?
- **Not from Embedded GPS:** Video files (e.g., MP4, MOV, WebM) uploaded or scraped from social platforms **do not** have GPS EXIF metadata read. `cv2.VideoCapture` and `yt-dlp` in MediaGuardSports never parse GPS tags.
- **Not from IP / Network Geolocation:** There is no GeoIP (MaxMind / ipinfo) integration. The server never inspects client IP addresses or uploader network routes.
- **Not from Visual Landmark Inference:** Neither MobileNetV3 nor Gemini/Nemotron is tasked with recognizing geographic landmarks, text overlays, or stadiums for location purposes.
- **Actual Source:** 
  A hardcoded Python dictionary of 30 country centroids (`COUNTRY_CENTROIDS` in `spider.py:18-49`):
  ```python
  COUNTRY_CENTROIDS = {
      "US": {"lat": 37.0902,  "lng": -95.7129},
      "CA": {"lat": 56.1304,  "lng": -106.3468},
      "MX": {"lat": 23.6345,  "lng": -102.5528},
      "IN": {"lat": 20.5937,  "lng": 78.9629},
      "JP": {"lat": 36.2048,  "lng": 138.2529},
      ...
  }
  ```
  The country code is obtained from `info.get("channel_country")` from YouTube channel metadata.

---

### 4. Are coordinates measured, inferred, or mock/demo data?
- **Confirmed Finding:** The coordinates are **static geographic centroids**, with a **synthetic random fallback**.
- In `Backend/agents/spider.py`, lines 144–147:
  ```python
  country = entry.get("channel_country")
  if not country or country not in COUNTRY_CENTROIDS:
      country = random.choice(list(COUNTRY_CENTROIDS.keys()))
  ```
- Because public YouTube video uploaders rarely declare a `channel_country` in public metadata, **the vast majority of suspect coordinates in MediaGuardSports are chosen at random** using `random.choice()`.
- Placing a pin at `{lat: 20.5937, lng: 78.9629}` does not mean the pirated broadcast originated in India; it merely means India's geographic center was selected from the list.

---

### 5. How missing or uncertain coordinates are handled
- In `spider.py`: If `country` is missing, a random country is selected.
- In `swarmController.js:118`: If `node.coordinates` is undefined, it falls back to `{ lat: 0, lng: 0 }` (Null Island in the Gulf of Guinea).
- In `ThreatMap.jsx:194`: If `officialSource.coordinates` is missing, the frontend hardcodes New York City coordinates:
  ```javascript
  const originCoords = officialSource?.coordinates
    ? [officialSource.coordinates.lat, officialSource.coordinates.lng]
    : [40.7128, -74.006]; // default NYC
  ```
- In `ThreatMap.jsx:237`: Incidents without valid `lat` and `lng` are silently filtered out:
  ```javascript
  incidents.filter(i => i.coordinates?.lat && i.coordinates?.lng)
  ```

---

### 6. What the location actually represents
- In the best-case scenario (where `channel_country` exists and is honest), the location represents the **country of account registration** for the YouTube channel that uploaded the video.
- It does **not** represent:
  - The stadium or venue where the sports event took place.
  - The physical location where the broadcast footage was captured or filmed.
  - The CDN edge server or ingest location.
  - The geographic jurisdiction of the uploader.

---

### 7. End-to-end functionality status
- **Synthetic/Demo Level Only:**
  - The feature only functions when running MediaGuardSports' specific multi-agent YouTube crawler (`spider.py`).
  - For direct video file uploads (the primary workflow of FixProof), no location coordinates exist whatsoever.
  - The visual map with connecting polylines and pulsing radar circles is an engaging visual effect for presentations, but has **zero forensic evidentiary value**.

---

### 8. Adaptability to FixProof: What would be required?
To implement a truly authentic geographic location system in FixProof:
1. **Direct Video Uploads:**
   - In commercial video distribution and social uploads, container metadata (MP4 `moov.udta` atoms, EXIF, or QuickTime keys) is almost universally stripped by social media transcoders (YouTube, X, TikTok, Instagram) for user privacy.
   - For raw camera footage from official sports broadcasters, embedded GPS metadata (e.g. ISO 6709 string in QuickTime metadata) could theoretically be parsed via `ffprobe` / `exiftool`.
2. **Public URL Screening:**
   - For URL screening (`POST /api/threats/screen-url`), FixProof extracts public metadata via `yt-dlp` (`download=False`).
   - We could optionally display the verified channel country in the metadata card (e.g. `Uploader Country: US (Declared Channel Metadata)`).
   - However, placing coordinate pins on a world map implies physical geographic discovery, which is false and misleading in a legal evidence package.
3. **Data Model Requirements:**
   - Would require adding `uploader_country?: string` and `declared_channel_location?: string` to `app/evidence_models.py` and `frontend/lib/types.ts`.
   - Modifying database migrations in Supabase to add nullable geographic fields.

---

## 4. Final Architecture Recommendation for FixProof

> [!IMPORTANT]
> **Recommendation: Do NOT add a map to FixProof in Phase 3.4.**
> 
> FixProof is a deterministic, court-admissible forensic verification system producing signed Ed25519 evidence packages. Incorporating a map based on synthetic random country centroids—or implying physical geolocation from YouTube channel metadata—would directly undermine FixProof's credibility with forensic investigators, legal counsel, and enterprise sports leagues.
> 
> Instead, Threat Hunter should focus on its core forensic strengths:
> 1. Clear upload vs. URL screening triage.
> 2. Transparent, honest pipeline progress visualization during active scans.
> 3. Rich, deterministic similarity results (MobileNetV3 L2 distance + 64-bit DCT pHash).
> 4. Direct navigation to synchronized video timeline playback in Incident Response.

If sports leagues require venue tracking in future phases, FixProof should implement an authentic **Official Asset Venue Registry**, where official broadcasts are tagged with their sanctioned stadium/venue coordinates at ingest time, rather than guessing pirate uploader locations.

---

## 5. Phase 3.4 Location Audit Decision & Future Direction

### Formal Decision: No Map Implementation
Following the completed audit of MediaGuardSports' location subsystem, **FixProof will not implement a map or display geographic pins based on random country assignments, guessed locations, or unverified channel metadata**. 

Displaying speculative or synthetic coordinates on an evidence dashboard compromises forensic admissibility and misleads investigators regarding the physical origin of unauthorized digital media.

### Potential Future Direction: Evidence-Backed Source Provenance
If geographic or network visualization is introduced in future architectural phases, it must adhere to strict forensic evidentiary boundaries:
1. **Source Provenance & Repost Tracking:**
   - Clearly distinguish between an **observed platform appearance** (e.g., a post indexed on YouTube or TikTok at a specific timestamp) and a **verified propagation relationship** (e.g., an authenticated direct download-and-reupload lineage).
   - Provenance relationships must be grounded in empirical data (cryptographic watermarks, matching compression artifacts, or verified platform API repost metadata), never speculative inferences.
2. **Reliable Geographic Data Requirements:**
   - Any future map visualization must require a **defined, reliable geographic data source** (such as sanctioned stadium coordinates from an authenticated venue registry, or network infrastructure points verified through direct subpoena/server logs).
   - The UI must display an **explicit statement of what each location represents** (e.g., "Sanctioned Match Venue" vs. "Uploader-Declared Account Region" vs. "Content Delivery Edge Node"), avoiding ambiguity between physical camera capture, broadcast transmission, and user residence.

