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

  async function queryHealthData(token) {
    // Google Health API - query aggregated data
    const startTime = `${targetDate}T00:00:00Z`;
    const endTime   = `${targetDate}T23:59:59Z`;

    // Try the Google Health REST API endpoint
    const r = await fetch(
      `https://health.googleapis.com/v1/users/-/sessions?startTime=${startTime}&endTime=${endTime}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const sessions = await r.json();

    // Also try aggregated metrics
    const metricsR = await fetch(
      'https://health.googleapis.com/v1/users/-:aggregateMetrics',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: ['STEPS_COUNT', 'CALORIES_EXPENDED', 'ACTIVE_MINUTES'],
          timeRange: { startTime, endTime }
        })
      }
    );
    const metrics = await metricsR.json();

    return { sessions, metrics, metricsStatus: metricsR.status, sessionsStatus: r.status };
  }

  async function queryFitnessAPI(token) {
    // Also try legacy Google Fitness API as fallback
    const startMs = new Date(targetDate + 'T00:00:00Z').getTime();
    const endMs   = new Date(targetDate + 'T23:59:59Z').getTime();
    const r = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
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
    return { data: await r.json(), status: r.status };
  }

  try {
    let token = access_token;
    let newRefreshToken = null;

    // Try Health API
    let healthData = await queryHealthData(token);

    // If 401, refresh token
    if (healthData.sessionsStatus === 401 || healthData.metricsStatus === 401) {
      if (!refresh_token) return res.status(401).json({ error: 'Token expired — please reconnect' });
      const refreshed = await refreshToken();
      if (!refreshed.access_token) return res.status(401).json({ error: 'Could not refresh token — please reconnect' });
      token = refreshed.access_token;
      newRefreshToken = refreshed.refresh_token || refresh_token;
      healthData = await queryHealthData(token);
    }

    // Also try Fitness API as fallback
    const fitnessData = await queryFitnessAPI(token);

    // Parse Health API metrics response
    let steps = 0, caloriesBurned = 0, activeMinutes = 0;

    // Try parsing from Health API metrics
    const metrics = healthData.metrics || {};
    if (metrics.steps !== undefined) steps = Math.round(metrics.steps || 0);
    if (metrics.calories !== undefined) caloriesBurned = Math.round(metrics.calories || 0);
    if (metrics.activeMinutes !== undefined) activeMinutes = Math.round(metrics.activeMinutes || 0);

    // Fall back to Fitness API if Health API returned nothing
    if (steps === 0 && caloriesBurned === 0 && fitnessData.status === 200) {
      (fitnessData.data.bucket || []).forEach(bucket => {
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
      debug: {
        health_metrics_status: healthData.metricsStatus,
        health_sessions_status: healthData.sessionsStatus,
        fitness_status: fitnessData.status,
        health_metrics_raw: healthData.metrics,
        health_sessions_raw: healthData.sessions,
        fitness_raw: fitnessData.data
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}
