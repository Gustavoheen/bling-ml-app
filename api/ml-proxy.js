// Serverless proxy: todas as chamadas ML (resolve CORS do browser → ML)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { endpoint, method = 'GET', body, accessToken } = req.body

  if (!endpoint) return res.status(400).json({ error: 'endpoint required' })

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  try {
    const fetchOpts = { method, headers }
    if (body && method !== 'GET') fetchOpts.body = JSON.stringify(body)

    const resp = await fetch(`https://api.mercadolibre.com${endpoint}`, fetchOpts)
    const data = await resp.json()
    return res.status(resp.status).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
