"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LandingPage } from "@/components/landing/LandingPage";
import { DashboardConsole } from "@/components/dashboard/DashboardConsole";

export default function RootPage() {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"landing" | "dashboard">("landing");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check if query param ?view=dashboard is passed
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("view") === "dashboard") {
        setViewMode("dashboard");
      }
    }
  }, []);

  const handleLaunch = () => {
    // Smooth in-place transition or router push
    setViewMode("dashboard");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/dashboard");
    }
  };

  const handleBackToLanding = () => {
    setViewMode("landing");
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", "/");
    }
  };

  if (viewMode === "dashboard") {
    return <DashboardConsole onBackToLanding={handleBackToLanding} defaultTab="overview" />;
  }

  return <LandingPage onLaunch={handleLaunch} />;
}
