import type { NextConfig } from "next";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      fs: false,
      assert: require.resolve('assert/'),
      util: require.resolve('util/'),
    };
    return config;
  },
};

export default nextConfig;
