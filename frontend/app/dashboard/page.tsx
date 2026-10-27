"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { DashboardConsole } from "@/components/dashboard/DashboardConsole";

export default function DashboardRoutePage() {
  const router = useRouter();

  return (
    <DashboardConsole
      onBackToLanding={() => router.push("/")}
      defaultTab="overview"
    />
  );
}
