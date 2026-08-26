export default async function handler(req, res) {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect(`${process.env.APP_URL || 'https://nutriai-tracker-kappa.vercel.app'}?fitbit_error=${error}`);
  }

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${process.env.APP_URL || 'https://nutriai-tracker-kappa.vercel.app'}/api/fitbit-callback`,
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();

    if (tokens.error) {
      return res.redirect(`${process.env.APP_URL || 'https://nutriai-tracker-kappa.vercel.app'}?fitbit_error=${tokens.error}`);
    }

    // Pass tokens back to the app via URL fragment (stays client-side, never logged)
    const params = new URLSearchParams({
      fitbit_access_token: tokens.access_token,
      fitbit_refresh_token: tokens.refresh_token || '',
      fitbit_expires_in: tokens.expires_in || 3600
    });

    return res.redirect(`${process.env.APP_URL || 'https://nutriai-tracker-kappa.vercel.app'}?${params.toString()}`);
  } catch (err) {
    return res.redirect(`${process.env.APP_URL || 'https://nutriai-tracker-kappa.vercel.app'}?fitbit_error=${encodeURIComponent(err.message)}`);
  }
}
