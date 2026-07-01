import type { FastifyPluginAsync } from 'fastify'

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    return {
      success: true,
      data: {
        ...app.waService.getConnectionStatus(),
        uptime: process.uptime(),
      },
    }
  })
}

export default healthRoute
