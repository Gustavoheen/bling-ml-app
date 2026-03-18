import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-dev-middleware',
      configureServer(server) {
        server.middlewares.use('/api/bling-proxy', async (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Content-Type', 'application/json')
          if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return }
          let body = ''
          req.on('data', c => body += c)
          req.on('end', async () => {
            try {
              const { endpoint, method = 'GET', body: reqBody, accessToken } = JSON.parse(body || '{}')
              if (!endpoint || !accessToken) { res.statusCode = 400; res.end(JSON.stringify({ error: 'endpoint e accessToken obrigatórios' })); return }
              const r = await fetch(`https://www.bling.com.br/Api/v3${endpoint}`, {
                method,
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: reqBody ? JSON.stringify(reqBody) : undefined,
              })
              const data = await r.json().catch(() => ({}))
              res.statusCode = r.status
              res.end(JSON.stringify(data))
            } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          })
        })

        server.middlewares.use('/api/bling-token', async (req, res) => {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Content-Type', 'application/json')
          if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return }
          let body = ''
          req.on('data', c => body += c)
          req.on('end', async () => {
            try {
              const { code, refresh_token, grant_type } = JSON.parse(body || '{}')
              const CLIENT_ID = process.env.VITE_BLING_CLIENT_ID
              const CLIENT_SECRET = process.env.VITE_BLING_CLIENT_SECRET
              const REDIRECT_URI = process.env.VITE_BLING_REDIRECT_URI
              const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
              const params = new URLSearchParams({ grant_type: grant_type || 'authorization_code' })
              if (grant_type === 'refresh_token') params.append('refresh_token', refresh_token)
              else { params.append('code', code); params.append('redirect_uri', REDIRECT_URI) }
              const r = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
                method: 'POST',
                headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
                body: params.toString(),
              })
              const data = await r.json()
              res.statusCode = r.status
              res.end(JSON.stringify(data))
            } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          })
        })
      }
    }
  ],
})
