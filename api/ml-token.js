// Serverless proxy: ML OAuth token exchange (avoids CORS + keeps secret server-side)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { grant_type, code, refresh_token, redirect_uri } = req.body

  const CLIENT_ID = process.env.VITE_ML_CLIENT_ID
  const CLIENT_SECRET = process.env.VITE_ML_CLIENT_SECRET
  const REDIRECT_URI = redirect_uri || process.env.VITE_ML_REDIRECT_URI

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'ML credentials not configured' })
  }

  const params = new URLSearchParams({ grant_type, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
  if (grant_type === 'authorization_code') {
    params.set('code', code)
    params.set('redirect_uri', REDIRECT_URI)
  } else if (grant_type === 'refresh_token') {
    params.set('refresh_token', refresh_token)
  }

  try {
    const resp = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: params.toString(),
    })
    const data = await resp.json()
    if (!resp.ok) return res.status(resp.status).json(data)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
