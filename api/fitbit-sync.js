export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { access_token, refresh_token, date } = req.body;
  if (!access_token) return res.status(400).json({ error: 'No access token' });

  const targetDate = date || new Date().toISOString().split('T')[0];

  try {
    // Try with current token first
    let token = access_token;
    let newRefreshToken = null;

    // Fetch activity summary from Google Health / Fitbit
    const fetchData = async (tok) => {
      // Google Health API - daily activity aggregation
      const endTime = `${targetDate}T23:59:59Z`;
      const startTime = `${targetDate}T00:00:00Z`;

      const response = await fetch(
        `https://health.googleapis.com/v1/users/-/sessions?startTime=${startTime}&endTime=${endTime}`,
        { headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }
      );
      return response;
    };

    let response = await fetchData(token);

    // If 401, try refreshing the token
    if (response.status === 401 && refresh_token) {
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
      const refreshData = await refreshRes.json();
      if (refreshData.access_token) {
        token = refreshData.access_token;
        newRefreshToken = refreshData.refresh_token || refresh_token;
        response = await fetchData(token);
      } else {
        return res.status(401).json({ error: 'Token expired — please reconnect Fitbit' });
      }
    }

    // Also fetch aggregated daily steps + calories
    const aggRes = await fetch(
      'https://health.googleapis.com/v1/users/-/dataset:aggregate',
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
          startTimeMillis: new Date(`${targetDate}T00:00:00Z`).getTime(),
          endTimeMillis: new Date(`${targetDate}T23:59:59Z`).getTime()
        })
      }
    );

    const aggData = await aggRes.json();
    let steps = 0, caloriesBurned = 0, activeMinutes = 0;

    if (aggData.bucket && aggData.bucket.length > 0) {
      aggData.bucket.forEach(bucket => {
        (bucket.dataset || []).forEach(ds => {
          (ds.point || []).forEach(point => {
            const val = point.value?.[0];
            if (!val) return;
            if (ds.dataSourceId?.includes('step_count')) steps += val.intVal || 0;
            if (ds.dataSourceId?.includes('calories')) caloriesBurned += Math.round(val.fpVal || 0);
            if (ds.dataSourceId?.includes('active_minutes')) activeMinutes += val.intVal || 0;
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
      new_refresh_token: newRefreshToken
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
