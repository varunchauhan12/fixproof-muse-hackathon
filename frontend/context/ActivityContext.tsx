"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { API_BASE, getClientSessionId, setClientSessionId } from "@/lib/api";
import { IslandTask, IslandTaskStatus } from "@/components/kokonutui/status-island";

export interface ActivityTask extends IslandTask {
  timestamp: number;
}

interface ActivityContextType {
  tasks: IslandTask[];
  backendHealth: "healthy" | "offline" | "checking";
  activeIncidentId: string | null;
  setActiveIncidentId: (id: string | null, sessionId?: string | null) => void;
  addTask: (task: Omit<IslandTask, "id"> & { id?: string }) => string;
  updateTask: (id: string, updates: Partial<Omit<IslandTask, "id">>) => void;
  dismissTask: (id: string) => void;
  clearCompleted: () => void;
  checkHealth: () => Promise<void>;
}

const ActivityContext = createContext<ActivityContextType | null>(null);

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<IslandTask[]>([]);
  const [backendHealth, setBackendHealth] = useState<"healthy" | "offline" | "checking">("checking");
  const [activeIncidentId, setActiveIncidentIdState] = useState<string | null>(null);
  const taskCounter = useRef(0);

  const setActiveIncidentId = useCallback((id: string | null, sessionId?: string | null) => {
    setActiveIncidentIdState(id);
    if (sessionId && sessionId !== getClientSessionId()) {
      setClientSessionId(sessionId);
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("fixproof_muse_select_incident", {
          detail: id,
        })
      );
    }
  }, []);

  // Check real backend health
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/muse/status`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        setBackendHealth("healthy");
      } else {
        setBackendHealth("offline");
      }
    } catch {
      setBackendHealth("offline");
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [checkHealth]);

  const addTask = useCallback((taskData: Omit<IslandTask, "id"> & { id?: string }): string => {
    taskCounter.current += 1;
    const id = taskData.id || `task-${Date.now()}-${taskCounter.current}`;
    const newTask: IslandTask = {
      ...taskData,
      id,
    };

    setTasks((prev) => {
      // Remove any existing task with same ID
      const filtered = prev.filter((t) => t.id !== id);
      return [...filtered, newTask];
    });

    return id;
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<Omit<IslandTask, "id">>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const dismissTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "running"));
  }, []);

  const contextValue = React.useMemo(
    () => ({
      tasks,
      backendHealth,
      activeIncidentId,
      setActiveIncidentId,
      addTask,
      updateTask,
      dismissTask,
      clearCompleted,
      checkHealth,
    }),
    [
      tasks,
      backendHealth,
      activeIncidentId,
      setActiveIncidentId,
      addTask,
      updateTask,
      dismissTask,
      clearCompleted,
      checkHealth,
    ]
  );

  return (
    <ActivityContext.Provider value={contextValue}>
      {children}
    </ActivityContext.Provider>
  );
}

export function useActivity() {
  const context = useContext(ActivityContext);
  if (!context) {
    throw new Error("useActivity must be used within an ActivityProvider");
  }
  return context;
}
