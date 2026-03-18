export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const { code, refresh_token, grant_type } = req.body

  const CLIENT_ID = process.env.VITE_BLING_CLIENT_ID
  const CLIENT_SECRET = process.env.VITE_BLING_CLIENT_SECRET
  const REDIRECT_URI = process.env.VITE_BLING_REDIRECT_URI

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

  const body = new URLSearchParams({ grant_type: grant_type || 'authorization_code' })
  if (grant_type === 'refresh_token') {
    body.append('refresh_token', refresh_token)
  } else {
    body.append('code', code)
    body.append('redirect_uri', REDIRECT_URI)
  }

  try {
    const response = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    })

    const data = await response.json()
    if (!response.ok) return res.status(response.status).json(data)
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
