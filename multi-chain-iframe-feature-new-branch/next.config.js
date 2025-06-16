/** @type {import('next').NextConfig} */
  const nextConfig = {
    reactStrictMode: true,
    env: {
      ZKMEAPI_API_KEY: process.env.ZKMEAPI_API_KEY,
      THIRDWEB_SECRET_KEY: process.env.THIRDWEB_SECRET_KEY,
    },
  }

  module.exports = {
    distDir: 'build',
  }
  