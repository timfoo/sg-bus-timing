import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '')

  return {
    root: import.meta.dirname,
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api/bus-arrival': {
          target: 'https://datamall2.mytransport.sg',
          changeOrigin: true,
          rewrite: (path) => path.replace('/api/bus-arrival', '/ltaodataservice/v3/BusArrival'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('AccountKey', env.LTA_API_KEY ?? '')
            })
          },
        },
        '/api/bus-stops': {
          target: 'https://datamall2.mytransport.sg',
          changeOrigin: true,
          rewrite: (path) => path.replace('/api/bus-stops', '/ltaodataservice/v3/BusStops'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('AccountKey', env.LTA_API_KEY ?? '')
            })
          },
        },
      },
    },
  }
})
