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

  try {
    // First check what data sources exist in this account
    let sourcesRes = await fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataSources',
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Refresh token if expired
    if (sourcesRes.status === 401 && refresh_token) {
      const refreshed = await refreshToken();
      if (refreshed.access_token) {
        token = refreshed.access_token;
        newRefreshToken = refreshed.refresh_token || refresh_token;
        sourcesRes = await fetch(
          'https://www.googleapis.com/fitness/v1/users/me/dataSources',
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
    }

    const sourcesData = await sourcesRes.json();
    const allSources = (sourcesData.dataSource || []).map(s => s.dataStreamId);
    const stepSources   = allSources.filter(s => s.includes('step'));
    const calSources    = allSources.filter(s => s.includes('calori'));
    const activeSources = allSources.filter(s => s.includes('active') || s.includes('activity'));

    // Now fetch actual data
    const startMs = new Date(targetDate + 'T00:00:00Z').getTime();
    const endMs   = new Date(targetDate + 'T23:59:59Z').getTime();

    const fitRes = await fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
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
      }
    );
    const fitData = await fitRes.json();

    let steps = 0, caloriesBurned = 0, activeMinutes = 0;
    (fitData.bucket || []).forEach(bucket => {
      (bucket.dataset || []).forEach(ds => {
        (ds.point || []).forEach(point => {
          const val = point.value?.[0];
          if (!val) return;
          const src = ds.dataSourceId || '';
          if (src.includes('step_count'))     steps          += (val.intVal  || 0);
          if (src.includes('calories'))       caloriesBurned += Math.round(val.fpVal || 0);
          if (src.includes('active_minutes')) activeMinutes  += (val.intVal  || 0);
        });
      });
    });

    return res.json({
      date: targetDate,
      steps,
      calories_burned: caloriesBurned,
      active_minutes: activeMinutes,
      new_access_token: token !== access_token ? token : null,
      new_refresh_token: newRefreshToken,
      debug: {
        total_sources: allSources.length,
        step_sources: stepSources,
        calorie_sources: calSources,
        active_sources: activeSources,
        all_sources: allSources,
        fitness_status: fitRes.status,
        bucket_count: (fitData.bucket || []).length
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
