export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, refresh_token, date } = req.body;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  const targetDate = date || new Date().toISOString().split('T')[0];

  async function refreshToken() {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token'
      })
    });
    return r.json();
  }

  let token = access_token;
  let newRefreshToken = null;
  const debug = { attempts: [] };

  // Helper to safely fetch and parse JSON
  async function safeFetch(url, options = {}) {
    const r = await fetch(url, options);
    const text = await r.text();
    debug.attempts.push({ url: url.substring(0, 80), status: r.status, preview: text.substring(0, 200) });
    try {
      return { status: r.status, data: JSON.parse(text) };
    } catch(e) {
      return { status: r.status, data: null, raw: text.substring(0, 300) };
    }
  }

  try {
    // ── Try 1: Google Fitness API (most reliable) ──────────────
    const startMs = new Date(targetDate + 'T00:00:00Z').getTime();
    const endMs   = new Date(targetDate + 'T23:59:59Z').getTime();

    let fit = await safeFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: 'com.google.step_count.delta' },
          { dataTypeName: 'com.google.calories.expended' },
          { dataTypeName: 'com.google.active_minutes' }
        ],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: startMs,
        endTimeMillis: endMs
      })
    });

    // Token expired — refresh and retry
    if (fit.status === 401 && refresh_token) {
      const refreshed = await refreshToken();
      if (refreshed.access_token) {
        token = refreshed.access_token;
        newRefreshToken = refreshed.refresh_token || refresh_token;
        fit = await safeFetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aggregateBy: [
              { dataTypeName: 'com.google.step_count.delta' },
              { dataTypeName: 'com.google.calories.expended' },
              { dataTypeName: 'com.google.active_minutes' }
            ],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: startMs,
            endTimeMillis: endMs
          })
        });
      }
    }

    // ── Try 2: Google Health API ───────────────────────────────
    const startTime = targetDate + 'T00:00:00Z';
    const endTime   = targetDate + 'T23:59:59Z';
    const health = await safeFetch(
      `https://health.googleapis.com/v1/users/-/sessions?startTime=${startTime}&endTime=${endTime}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Parse Google Fitness results
    let steps = 0, caloriesBurned = 0, activeMinutes = 0;
    if (fit.data?.bucket) {
      fit.data.bucket.forEach(bucket => {
        (bucket.dataset || []).forEach(ds => {
          (ds.point || []).forEach(point => {
            const val = point.value?.[0];
            if (!val) return;
            const src = ds.dataSourceId || '';
            if (src.includes('step_count'))     steps          += (val.intVal || 0);
            if (src.includes('calories'))       caloriesBurned += Math.round(val.fpVal || 0);
            if (src.includes('active_minutes')) activeMinutes  += (val.intVal || 0);
          });
        });
      });
    }

    return res.json({
      date: targetDate,
      steps,
      calories_burned: caloriesBurned,
      active_minutes: activeMinutes,
      new_access_token: token !== access_token ? token : null,
      new_refresh_token: newRefreshToken,
      debug
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, debug });
  }
}
