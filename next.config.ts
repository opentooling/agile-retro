import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  serverExternalPackages: ['pdfmake', '@foliojs-fork/fontkit', '@foliojs-fork/restructure'],
};

export default nextConfig;
