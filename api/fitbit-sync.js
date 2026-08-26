export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, refresh_token, date } = req.body;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  const targetDate = date || new Date().toISOString().split('T')[0];

  async function refreshAccessToken() {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token'
      })
    });
    return refreshRes.json();
  }

  async function fetchFitnessData(token) {
    const startMs = new Date(targetDate + 'T00:00:00Z').getTime();
    const endMs   = new Date(targetDate + 'T23:59:59Z').getTime();

    const body = {
      aggregateBy: [
        { dataTypeName: 'com.google.step_count.delta'    },
        { dataTypeName: 'com.google.calories.expended'   },
        { dataTypeName: 'com.google.active_minutes'      },
        { dataTypeName: 'com.google.heart_minutes'       }
      ],
      bucketByTime: { durationMillis: 86400000 },
      startTimeMillis: startMs,
      endTimeMillis:   endMs
    };

    const r = await fetch(
      'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );
    return r;
  }

  try {
    let token = access_token;
    let newRefreshToken = null;

    let response = await fetchFitnessData(token);

    // Token expired — refresh it
    if (response.status === 401 && refresh_token) {
      const refreshed = await refreshAccessToken();
      if (!refreshed.access_token) {
        return res.status(401).json({ error: 'Token expired — please reconnect Fitbit' });
      }
      token = refreshed.access_token;
      newRefreshToken = refreshed.refresh_token || refresh_token;
      response = await fetchFitnessData(token);
    }

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || 'Google Fitness API error',
        details: data
      });
    }

    let steps = 0, caloriesBurned = 0, activeMinutes = 0;

    (data.bucket || []).forEach(bucket => {
      (bucket.dataset || []).forEach(ds => {
        (ds.point || []).forEach(point => {
          const val = point.value?.[0];
          if (!val) return;
          const src = ds.dataSourceId || '';
          if (src.includes('step_count'))    steps         += (val.intVal  || 0);
          if (src.includes('calories'))      caloriesBurned += Math.round(val.fpVal || 0);
          if (src.includes('active_minutes'))activeMinutes  += (val.intVal  || 0);
        });
      });
    });

    return res.json({
      date: targetDate,
      steps,
      calories_burned: caloriesBurned,
      active_minutes:  activeMinutes,
      raw_bucket_count: (data.bucket || []).length,
      new_access_token:  token !== access_token ? token : null,
      new_refresh_token: newRefreshToken
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
