# FixProof
<img width="2048" height="1152" alt="COVERIMAGENVIDIA" src="https://github.com/user-attachments/assets/e4fef6a2-49f7-404d-bd67-257868f1f28b" />

### AI-Powered Sports Media Verification & Digital Evidence

**Find potential visual matches. Investigate suspicious media reuse. Build verifiable evidence packages.**

FixProof is an AI-powered platform designed to help sports rights holders and media investigators identify potential unauthorized reuse of video content, analyze candidate matches, and organize investigation findings into integrity-checkable evidence packages.

It combines computer vision, vector similarity search, NVIDIA Nemotron models through Nebius Token Factory, and cryptographic integrity checks in a single investigation workflow.

**Live Demo:** [Open FixProof](https://fixproof-frontend-214713402646.europe-west1.run.app)  
**Source Code:** [GitHub Repository](https://github.com/varunchauhan12/FIXPROOF)

---
<img width="1461" height="776" alt="Screenshot 2026-10-29 at 4 43 09 PM" src="https://github.com/user-attachments/assets/5d6f21bc-dc85-458e-94ce-7beac60c1fa0" />
<img width="1464" height="777" alt="image" src="https://github.com/user-attachments/assets/b7080daa-9148-4bd4-90ef-c5b5601c79bf" />
<img width="1450" height="772" alt="Screenshot 2026-10-29 at 16 46 23" src="https://github.com/user-attachments/assets/42cf6f2f-cc69-4af2-b8ef-ee0a3d35040c" />



## The Problem

Sports media is distributed across websites and digital platforms, making it difficult for rights holders to investigate potential unauthorized reuse efficiently.

A useful investigation needs more than a simple visual match. Investigators need a way to find candidate frames, examine the results, document the analysis, and preserve the integrity of the resulting files.

Existing manual workflows can involve repetitive searching, disconnected tools, and time-consuming evidence preparation.

## Our Solution

FixProof brings visual matching, AI-assisted investigation, and evidence preparation into one workflow.

The platform processes reference media and candidate footage, searches for visually similar frames, uses AI models to assist with analysis, and generates investigation artifacts that can be checked for integrity.

FixProof is designed to **support human investigation, not automatically determine copyright infringement**.

## Key Features

- **Reference media ingestion:** Process supported reference video assets and build a searchable visual index.
- **Computer vision:** Extract video keyframes and generate visual embeddings.
- **Similarity search:** Use FAISS to retrieve candidate visual matches.
- **Visual filtering:** Apply entropy-based filtering and perceptual hashing to refine candidate comparisons.
- **AI-assisted verification:** Integrate NVIDIA Nemotron models through Nebius Token Factory for supported investigation and visual-analysis workflows.
- **Investigation reports:** Generate structured findings and PDF reports.
- **Evidence integrity:** Use cryptographic hashes and Ed25519 signatures for supported evidence-verification workflows.
- **Evidence packaging:** Assemble investigation artifacts into downloadable ZIP packages.
- **Package verification:** Check supported signatures, file digests, and archive safety conditions.
- **Human-reviewed actions:** Support the preparation of notices or revenue-sharing proposals, with human confirmation before optional email dispatch.

Feature availability and outputs depend on the media supplied and the applicable workflow.

## How It Works

1. **Ingest reference media.** Process supported footage and create a searchable visual representation.
2. **Extract and represent frames.** OpenCV extracts keyframes, and MobileNetV3-Small generates visual embeddings.
3. **Find candidate matches.** FAISS searches the visual index; entropy filtering and perceptual hashing help refine comparisons.
4. **Analyze candidates with AI.** Supported workflows send relevant inputs to NVIDIA Nemotron models through Nebius Token Factory.
5. **Review findings.** Investigators inspect candidate frames and AI-generated analysis.
6. **Generate evidence artifacts.** Produce reports and package the available investigation materials.
7. **Verify integrity.** Check the applicable signatures and file hashes, then review the verification result.

A candidate match is a lead for investigation, not proof of infringement.

## System Architecture


FixProof uses a web frontend, a Python API backend, computer-vision components, external AI inference, and persistent storage.

**Architecture diagram**

<img width="3200" height="1800" alt="fixproof-architecture" src="https://github.com/user-attachments/assets/bc47048f-72c7-439e-b575-0f71ecf7cfe8" />

**Visual Verification Flow Diagram**

<img width="1672" height="941" alt="FixProof Visual Verification Workflow" src="https://github.com/user-attachments/assets/b02a80a3-d113-4396-bb65-bd0dd092c2f6" />

**Evidence Lifecycle Diagram**

<img width="3400" height="2140" alt="fixproof-evidence-lifecycle" src="https://github.com/user-attachments/assets/69862727-0676-47f7-9f35-010b8d8582b8" />



### Main Components

| Component | Technology | Role |
|---|---|---|
| Frontend | Next.js, React | User interface and investigation workflows |
| Backend | Python, FastAPI | API endpoints and workflow orchestration |
| Frame processing | OpenCV | Video keyframe extraction |
| Visual embeddings | MobileNetV3-Small | Visual feature representation |
| Similarity search | FAISS | Candidate retrieval from vector representations |
| Visual filtering | Shannon entropy and pHash | Frame filtering and perceptual comparison |
| AI inference | NVIDIA Nemotron via Nebius Token Factory | Supported visual verification and investigation analysis |
| Database | Supabase PostgreSQL | Persistent application data |
| Object storage | Supabase Storage | Supported media and artifact storage |
| Reports | ReportLab | PDF generation |
| Integrity | SHA-256 and Ed25519 | File digests and digital signature verification |
| Email | Resend | Optional email delivery for supported workflows |

### Model Usage

FixProof integrates NVIDIA Nemotron models through Nebius Token Factory for distinct investigation tasks:

| Model | Role in FixProof |
|---|---|
| `nvidia/Nemotron-3_5-Lightning` | Structured investigation reports and document drafting |
| `nvidia/Nemotron-3.5-Super-VL` | Pairwise visual verification of shortlisted reference and suspect frames |
| `nvidia/nemotron-3-super-120b-a12b` | Detailed investigation report generation, with a documented fallback to the primary reasoning model |

The computer-vision pipeline retrieves candidate matches; the Nemotron models provide additional analysis within the relevant workflows. These are separate stages.

AI-generated findings are intended to assist investigators. They do not independently determine whether copyright infringement has occurred.

## Evidence Integrity

FixProof includes cryptographic mechanisms intended to help investigators detect changes to supported evidence artifacts.

- **SHA-256:** Calculates file digests for integrity checking.
- **Ed25519:** Supports digital signing and signature verification.
- **Evidence manifest:** Records supported metadata about packaged artifacts.
- **ZIP packaging:** Bundles investigation materials for export.
- **Verification workflow:** Checks the relevant integrity information and reports verification outcomes.

These mechanisms help establish whether covered files match their expected cryptographic values. They do not independently establish the truth of an allegation, the authenticity of the original media, or legal admissibility.

## Technology Stack

**Frontend:** Next.js, React  
**Backend:** Python, FastAPI  
**Computer vision:** OpenCV, MobileNetV3-Small  
**Vector retrieval:** FAISS  
**AI inference:** NVIDIA Nemotron, Nebius Token Factory  
**Persistence:** Supabase PostgreSQL, Supabase Storage  
**Evidence generation:** ReportLab, ZIP packaging, SHA-256, Ed25519  
**Email delivery:** Resend
## Getting Started

### Prerequisites

- Node.js and npm
- Python 3
- Supabase credentials for cloud persistence and object storage
- Nebius Token Factory API access for AI-enabled workflows

### Clone the Repository

```bash
git clone https://github.com/varunchauhan12/FIXPROOF.git
cd FIXPROOF
```

### Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend Setup

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend development server runs at `http://localhost:3000`.

Configure the environment variables required by the frontend and backend before using features that depend on external services. Never commit API keys or service credentials.

See `.env.example` for the available configuration variables and their documented defaults.

## Testing and Validation

The following checks were executed during repository validation.

### Frontend Production Build

Command:

```bash
cd frontend && npm run build
```

**Result:** Passed. The production build compiled successfully, and the `/`, `/_not-found`, and `/dashboard` routes were generated.

### Backend Unit Tests

Command:

```bash
cd backend && .venv/bin/python -m unittest tests.test_cloud_runtime tests.test_vault
```

**Result:** 25 tests ran in 37.803 seconds. The test runner reported `OK`, with one test skipped and no failures or errors.

### Validation Scope

These results apply to the specific commands and test modules listed above. They do not establish that every test suite or every deployed workflow has passed end-to-end validation.

Visual similarity scores are heuristic signals, not calibrated probabilities of copyright infringement. AI-generated investigation findings require human review.

### Environment Configuration

| Variable | Purpose |
|---|---|
| `FIXPROOF_DB_MODE` | Selects local or Supabase persistence |
| `SUPABASE_DB_URL` | Supabase PostgreSQL connection |
| `SUPABASE_URL` | Supabase service endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend object-storage access |
| `NEBIUS_API_KEY` | Nebius Token Factory authentication |
| `NEBIUS_MODEL` | Optional primary reasoning model override |
| `DETAILED_REPORT_MODEL` | Optional detailed-report model override |
| `FIXPROOF_SIGNING_KEY_HEX` | Ed25519 signing-key configuration |
| `RESEND_API_KEY` | Optional email dispatch integration |
| `FROM_EMAIL` | Outgoing email sender address |
| `NEXT_PUBLIC_API_URL` | Frontend backend API base URL |

Required configuration depends on the selected persistence mode and enabled features. Use environment variables or a local, untracked environment file for secrets. Never commit real credential values.

## Limitations and Responsible Use

- Visual similarity indicates a potential match, not a definitive copyright violation.
- Results depend on source-media quality, available reference material, and configured matching thresholds.
- Public URL analysis is limited to the metadata, thumbnails, or media content the implemented workflow can access.
- AI-generated findings may be incomplete or incorrect and require human review.
- Cryptographic verification covers only the artifacts and metadata included in the implemented integrity workflow.
- FixProof does not claim automatic legal adjudication, guaranteed detection, or guaranteed legal admissibility.

## Project Status

FixProof is a working project with a deployed web interface and backend. Refer to the live demo and repository for the current implementation.

## Contributing

Contributions, bug reports, and suggestions are welcome. Please open an issue to discuss substantial changes before submitting a pull request.

## License


This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

**FixProof — Visual matching, AI-assisted investigation, and evidence integrity.**
