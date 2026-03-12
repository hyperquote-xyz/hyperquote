import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  webpack: (config) => {
    // Suppress "Module not found" warnings from optional peer dependencies
    // of wagmi connectors that are never used at runtime in a web build:
    //   - @react-native-async-storage/async-storage (MetaMask SDK)
    //   - pino-pretty (WalletConnect logger, optional formatter)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webpack = require("webpack");
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(@react-native-async-storage\/async-storage|pino-pretty)$/,
      })
    );

    return config;
  },
};

export default nextConfig;
