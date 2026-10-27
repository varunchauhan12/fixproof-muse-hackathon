# FixProof — Meta Muse Hackathon Edition

> **Forensic Video Authenticity & Copyright Intelligence Engine**  
> *Prepared for the Meta Muse Hackathon (October 2026)*

FixProof is a real-time multimodal forensic intelligence platform that protects content creators, broadcasters, and rights holders against unauthorized digital rebroadcasting, video manipulation, and pirated streams. By combining neural visual feature extraction, perceptual hashing, temporal timeline clustering, and multimodal AI reasoning, FixProof rapidly pinpoints matched video frames and generates verifiable, evidence-grounded investigation reports.

---

## ⚠️ Hackathon Scope, Lineage & Baseline Disclosure

In full accordance with event integrity standards, this repository provides complete transparency regarding its pre-existing foundations versus hackathon deliverables:

### 1. Pre-Kickoff Starter Foundation (Pre-October 26, 2026)
Prior to the hackathon kickoff, an exploratory prototype established:
- Basic FastAPI service structure and initial MobileNetV3 visual embedding pipeline.
- Local FAISS vector index prototyping and frame perceptual hashing (`dhash`/`phash`).
- Next.js application skeleton and basic CSS styling layout.

### 2. Hackathon Sprint Development (October 26–27, 2026)
During the hackathon sprint, the following major capabilities were engineered:
- **Forensic Threat Hunter & Ingestion:** Multi-format video intake (MP4, MOV, MKV, AVI, WebM) with temporal sub-clip extraction.
- **SSRF-Hardened URL Screening:** Pre-flight URL screening engine with private IP blocking, DNS re-resolution, domain allowlisting, and metadata extraction.
- **Evidence-Grounded Investigation Engine:** Temporal frame match clustering, source-correspondence interval reconstruction, and structured forensic reporting.
- **Cloud Persistence Engine:** Dual-mode database layer supporting zero-dependency local JSON storage alongside Supabase PostgreSQL connection pooler and private storage buckets.
- **Analyst Investigation Console:** Interactive forensic dashboard exposing incident IDs, timeline intervals, evidence metrics, and real-time status indicators.

### 3. Meta Muse Integration Status
- **Current Status:** **Scaffold & Preparation Phase**.
- The codebase is structured with isolated configuration namespaces (`MUSE_API_KEY`, `MUSE_BASE_URL`, `MUSE_MODEL`) distinct from legacy inference providers.
- Multimodal reasoning models from the Meta Muse family (e.g., `meta-models/muse-spark-open`) are being integrated into the forensic investigation workflow to synthesize temporal visual evidence into natural-language forensic conclusions.
- **Note:** In keeping with strict submission accuracy, the Meta Muse provider adapter is in active development and will be validated against live test vectors before claiming full production integration.

---

## Architecture Overview

```
                                 ┌──────────────────────────────────────────────┐
                                 │            FixProof Analyst UI               │
                                 │   Next.js 15 App Router + Tailwind CSS        │
                                 └──────────────────────┬───────────────────────┘
                                                        │ HTTP / REST
                                                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       FixProof FastAPI Backend                                          │
│                                                                                                        │
│   ┌───────────────────────────┐   ┌───────────────────────────┐   ┌────────────────────────────────┐   │
│   │   Ingest & URL Screener   │   │  Forensic Vision Pipeline │   │     Investigation Engine       │   │
│   │ • SSRF Protection         │   │ • MobileNetV3 Embeddings  │   │ • Temporal Match Clustering    │   │
│   │ • Multi-format Ingest     │──▶│ • FAISS Vector Vault      │──▶│ • Source Timeline Interval     │   │
│   │ • yt-dlp Video Retrieval  │   │ • Perceptual Hashing      │   │ • Meta Muse Multimodal Agent   │   │
│   └───────────────────────────┘   └───────────────────────────┘   └────────────────┬───────────────┘   │
│                                                                                    │                   │
│                                   ┌───────────────────────────┐                    │                   │
│                                   │ Dual-Mode Persistence     │◀───────────────────┘                   │
│                                   │ • Local JSON Registry     │                                        │
│                                   │ • Supabase PostgreSQL     │                                        │
│                                   └───────────────────────────┘                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
fixproof-muse-hackathon/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI application entry point & REST endpoints
│   │   ├── matcher.py               # MobileNetV3 visual extractor & FAISS/pHash matcher
│   │   ├── evidence_models.py       # Pydantic schemas for evidence, intervals & reports
│   │   ├── timeline.py              # Temporal frame match clustering algorithms
│   │   ├── url_screener.py          # SSRF-hardened suspect URL screening engine
│   │   ├── vault.py                 # Vector database manager & local indexing
│   │   ├── registry.py              # Storage abstraction layer (Local / Supabase)
│   │   ├── db.py                    # Database connection manager & session pooling
│   │   ├── storage.py               # Supabase signed-URL & object storage client
│   │   └── nemotron_engine.py       # Investigation foundation (adaptation target for Muse)
│   ├── migrations/                  # PostgreSQL schema definitions (001_initial_schema.sql)
│   ├── tests/                       # Comprehensive pytest suite
│   ├── requirements.txt             # Python backend dependencies
│   ├── .env.example                 # Environment template with placeholders
│   └── .gitignore                   # Backend-specific ignore rules
│
├── frontend/
│   ├── app/                         # Next.js 15 App Router pages & layouts
│   ├── components/
│   │   └── dashboard/
│   │       ├── IncidentResponse.tsx # Forensic investigation reports & copy controls
│   │       ├── ThreatHunter.tsx     # Suspect video scanning & URL screening
│   │       ├── AssetVault.tsx       # Reference video asset management
│   │       └── DashboardConsole.tsx # Primary forensic workspace
│   ├── lib/
│   │   ├── api.ts                   # Strongly typed REST client helpers
│   │   └── types.ts                 # TypeScript data contracts & schemas
│   ├── tests/
│   │   └── test_investigation_integration.mjs # Frontend API & report test suite
│   ├── package.json                 # Node dependencies
│   └── .env.example                 # Frontend environment template
│
└── README.md                        # Project documentation & setup guide
```

---

## Quick Start & Setup Guide

### Prerequisites
- **Python 3.10+** (with `ffmpeg` installed for video frame extraction)
- **Node.js 18+** & **npm**

### 1. Backend Setup

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` with your preferred configuration:*
   - `FIXPROOF_DB_MODE=local` (Zero external setup required for local development)
   - `MUSE_API_KEY=your_meta_muse_api_key_here`
   - `MUSE_MODEL=meta-models/muse-spark-open`
   - *(Optional)* Supabase connection credentials if using cloud PostgreSQL.

5. **Run the backend development server:**
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   The interactive Swagger API documentation is available at `http://localhost:8000/docs`.

---

### 2. Frontend Setup

1. **Navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Start the Next.js development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to access the FixProof Analyst Console.

---

## Running Verification Tests

### Automated Frontend Suite
Run the Node.js test runner covering API contracts, report caching, error resilience, and clipboard handling:
```bash
node --test frontend/tests/test_investigation_integration.mjs
```

### Automated Backend Suite
Activate the backend virtual environment and execute pytest:
```bash
cd backend
pytest tests/
```

---

## Security & Ethics

- **Zero Secret Ingestion:** The repository excludes all `.env` files, production database passwords, cloud tokens, and live inference keys.
- **SSRF Mitigation:** The URL screening pipeline rejects loopback addresses (`127.0.0.1`), link-local interfaces (`169.254.0.0/16`), private subnets (`10.0.0.0/8`, `192.168.0.0/16`, `172.16.0.0/12`), and non-HTTP protocols.
- **Clean Licensing:** Utilizes standard open-source dependencies and standard PyTorch / Next.js toolchains.
