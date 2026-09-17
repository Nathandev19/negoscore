import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Interrupteur de maintenance copié au build pour le formulaire (pages
  // statiques). La route d'analyse relit ANALYSIS_PAUSED à chaque requête.
  env: { NEXT_PUBLIC_ANALYSIS_PAUSED: process.env.ANALYSIS_PAUSED === "1" ? "1" : "" },
};

export default nextConfig;
