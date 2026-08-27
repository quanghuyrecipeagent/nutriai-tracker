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
  const debug = {};

  async function tryRefreshIfNeeded(status) {
    if (status === 401 && refresh_token) {
      const refreshed = await refreshToken();
      if (refreshed.access_token) {
        token = refreshed.access_token;
        newRefreshToken = refreshed.refresh_token || refresh_token;
        return true;
      }
    }
    return false;
  }

  try {
    const startTime = `${targetDate}T00:00:00Z`;
    const endTime   = `${targetDate}T23:59:59Z`;

    // ── 1. Google Health API — activity_and_fitness scope ────────
    // This is what the Google Health app uses on iPhone
    let healthRes = await fetch(
      `https://health.googleapis.com/v1/users/-/sessions?startTime=${startTime}&endTime=${endTime}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (healthRes.status === 401) {
      await tryRefreshIfNeeded(401);
      healthRes = await fetch(
        `https://health.googleapis.com/v1/users/-/sessions?startTime=${startTime}&endTime=${endTime}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
    }
    const healthText = await healthRes.text();
    debug.health_sessions_status = healthRes.status;
    try { debug.health_sessions = JSON.parse(healthText); } catch(e) { debug.health_sessions_raw = healthText.slice(0,300); }

    // ── 2. Google Health API — aggregate metrics ─────────────────
    let metricsRes = await fetch(
      'https://health.googleapis.com/v1/users/-:aggregateMetrics',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aggregations: [
            { metricType: 'STEPS' },
            { metricType: 'CALORIES_BURNED' },
            { metricType: 'ACTIVE_DURATION' },
            { metricType: 'DISTANCE' }
          ],
          timeRange: { startTime, endTime }
        })
      }
    );
    const metricsText = await metricsRes.text();
    debug.metrics_status = metricsRes.status;
    try { debug.metrics = JSON.parse(metricsText); } catch(e) { debug.metrics_raw = metricsText.slice(0,300); }

    // ── 3. Google Health API — list available metric types ───────
    let typesRes = await fetch(
      'https://health.googleapis.com/v1/users/-/metricTypes',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const typesText = await typesRes.text();
    debug.types_status = typesRes.status;
    try { debug.metric_types = JSON.parse(typesText); } catch(e) { debug.types_raw = typesText.slice(0,500); }

    // Parse whatever we got
    let steps = 0, caloriesBurned = 0, activeMinutes = 0;

    // Try parsing metrics response
    const metricsData = debug.metrics;
    if (metricsData?.aggregations) {
      metricsData.aggregations.forEach(agg => {
        if (agg.metricType === 'STEPS') steps = Math.round(agg.value || 0);
        if (agg.metricType === 'CALORIES_BURNED') caloriesBurned = Math.round(agg.value || 0);
        if (agg.metricType === 'ACTIVE_DURATION') activeMinutes = Math.round((agg.value || 0) / 60);
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
    return res.status(500).json({ error: err.message, stack: err.stack?.slice(0,300) });
  }
}
