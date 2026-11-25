async function runLiveTest() {
  const baseUrl = 'http://localhost:5000/api/v1';
  const email = `e2e_live_${Date.now()}@example.com`;
  const password = 'Password123!';
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Protection': '1',
  };

  console.log('1. Registering user:', email);
  const regRes = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      firstName: 'Elena',
      lastName: 'Rostova',
    }),
  });
  const regData = await regRes.json();
  console.log('Register status:', regRes.status, 'success:', regData.success);

  console.log('2. Logging in...');
  const loginRes = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  });
  const loginData = await loginRes.json();
  const token = loginData.accessToken;
  console.log('Login status:', loginRes.status, 'Token acquired:', !!token);

  const authHeaders = {
    ...headers,
    Authorization: `Bearer ${token}`,
  };

  console.log('3. GET /users/me');
  const meRes = await fetch(`${baseUrl}/users/me`, {
    method: 'GET',
    headers: authHeaders,
  });
  const meData = await meRes.json();
  console.log('Profile status:', meRes.status, 'User ID:', meData.id, 'Email:', meData.email);

  console.log('4. GET /users/me/preferences');
  const pref1Res = await fetch(`${baseUrl}/users/me/preferences`, {
    method: 'GET',
    headers: authHeaders,
  });
  const pref1Data = await pref1Res.json();
  console.log('Default preferences:', pref1Data.data);

  console.log('5. PUT /users/me/preferences (muting microphone: false)');
  const pref2Res = await fetch(`${baseUrl}/users/me/preferences`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ defaultAudioMuted: false }),
  });
  const pref2Data = await pref2Res.json();
  console.log('After mic update:', pref2Data.data);

  console.log('6. PUT /users/me/preferences (video off: true)');
  const pref3Res = await fetch(`${baseUrl}/users/me/preferences`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ defaultVideoOff: true }),
  });
  const pref3Data = await pref3Res.json();
  console.log('After video update:', pref3Data.data);

  console.log('7. Final verification of GET /users/me/preferences:');
  const pref4Res = await fetch(`${baseUrl}/users/me/preferences`, {
    method: 'GET',
    headers: authHeaders,
  });
  const pref4Data = await pref4Res.json();
  console.log('Persisted preferences in MongoDB:', pref4Data.data);

  if (
    pref4Data.data.defaultAudioMuted === false &&
    pref4Data.data.defaultVideoOff === true
  ) {
    console.log('SUCCESS: All live API tests passed with genuine database persistence!');
  } else {
    throw new Error('Verification failed: preferences mismatch');
  }
}

runLiveTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
