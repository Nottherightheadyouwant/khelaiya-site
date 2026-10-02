import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  allowedDevOrigins: [
    "192.168.31.181",
    "192.168.31.181:3001",
    "localhost:3001",
    "*.ngrok-free.dev",
    "dominoes-speak-blinking.ngrok-free.dev",
    "*.ngrok.io",
    "*.ngrok-free.app",
  ],
};

export default nextConfig;
