import {
  AssetRecord,
  VaultStatus,
  MatchAnalysisResult,
  InvestigationReport,
  InvestigateIncidentPayload,
} from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const noCacheHeaders = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function fetchNoCache(url: string, init?: RequestInit): Promise<Response> {
  const separator = url.includes("?") ? "&" : "?";
  const cacheBustedUrl = `${url}${separator}_t=${Date.now()}`;
  return fetch(cacheBustedUrl, {
    ...init,
    cache: "no-store",
    headers: {
      ...noCacheHeaders,
      ...init?.headers,
    },
  });
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const res = await fetchNoCache(`${API_BASE}/health`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === "ok";
  } catch {
    return false;
  }
}

export async function getVaultStatus(): Promise<VaultStatus> {
  const res = await fetchNoCache(`${API_BASE}/api/vault/status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch vault status: ${res.statusText}`);
  }
  return res.json();
}

export async function getRegisteredAssets(): Promise<AssetRecord[]> {
  const res = await fetchNoCache(`${API_BASE}/api/vault/assets`);
  if (!res.ok) {
    throw new Error(`Failed to fetch registered assets: ${res.statusText}`);
  }
  return res.json();
}

export async function getAssetDetail(assetId: string): Promise<AssetRecord> {
  const res = await fetchNoCache(`${API_BASE}/api/vault/assets/${encodeURIComponent(assetId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch asset detail: ${res.statusText}`);
  }
  return res.json();
}

export async function ingestReferenceVideo(
  file: File,
  autoIndex: boolean = false
): Promise<AssetRecord> {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${API_BASE}/api/vault/ingest?auto_index=${autoIndex ? "true" : "false"}`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Upload failed with status ${res.status}`);
  }

  return res.json();
}

export async function indexAssetInVault(assetId: string): Promise<{
  status: string;
  asset_id: string;
  frames_indexed: number;
  vault_size: number;
}> {
  const res = await fetch(`${API_BASE}/api/vault/index/${encodeURIComponent(assetId)}`, {
    method: "POST",
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Indexing failed: ${res.statusText}`);
  }

  return res.json();
}

export async function deleteAssetFromVault(assetId: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/vault/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Delete failed: ${res.statusText}`);
  }
  return true;
}

export async function scanSuspectVideo(
  file: File,
  onUploadProgress?: (percent: number) => void
): Promise<MatchAnalysisResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/threats/scan`);

    if (xhr.upload && onUploadProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onUploadProgress(percent);
        }
      };
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as MatchAnalysisResult);
        } else {
          const detail = data?.detail || `Scan failed with status ${xhr.status}`;
          reject(new Error(detail));
        }
      } catch {
        if (xhr.status >= 200 && xhr.status < 300) {
          reject(new Error("Received non-JSON response from server."));
        } else {
          reject(new Error(`Server error (${xhr.status}): ${xhr.statusText || "Request failed"}`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network connection error. Check if FixProof backend is running."));
    };

    xhr.ontimeout = () => {
      reject(new Error("Scan request timed out. Video processing took too long."));
    };

    // 180-second timeout for large videos
    xhr.timeout = 180000;

    xhr.send(formData);
  });
}

export async function screenSuspectUrl(url: string): Promise<MatchAnalysisResult> {
  const res = await fetchNoCache(`${API_BASE}/api/threats/screen-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: url.trim() }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `URL screening failed with status ${res.status}`);
  }

  return res.json();
}

export async function getIncidentsList(): Promise<MatchAnalysisResult[]> {
  const res = await fetchNoCache(`${API_BASE}/api/incidents`);
  if (!res.ok) {
    throw new Error(`Failed to fetch incidents: ${res.statusText}`);
  }
  return res.json();
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export async function getIncidentLatestReport(
  incidentId: string
): Promise<InvestigationReport | null> {
  const safeId = encodeURIComponent(incidentId.trim());
  const res = await fetchNoCache(`${API_BASE}/api/threats/${safeId}/report`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to fetch report for incident ${incidentId}`);
  }
  return res.json();
}

export async function getReportById(
  reportId: string
): Promise<InvestigationReport> {
  const safeId = encodeURIComponent(reportId.trim());
  const res = await fetchNoCache(`${API_BASE}/api/threats/reports/${safeId}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Failed to fetch report ${reportId}`);
  }
  return res.json();
}

export async function investigateIncident(
  incidentId: string,
  payload?: InvestigateIncidentPayload
): Promise<InvestigationReport> {
  const safeId = encodeURIComponent(incidentId.trim());
  const res = await fetch(`${API_BASE}/api/threats/${safeId}/investigate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload || { force_refresh: false, model_override: null }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.detail || `Investigation failed with status ${res.status}`);
  }

  return res.json();
}

