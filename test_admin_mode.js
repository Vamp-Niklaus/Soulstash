async function test() {
  const loginRes = await fetch('http://localhost:3000/api/users/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@admin.com', password: 'password123' })
  });
  
  if (!loginRes.ok) {
    return null;
  }
  const { token } = await loginRes.json();
  return token;
}

test().then(async (token) => {
  if (!token) {
    console.log("No token, skipping test");
    return;
  }
  const res = await fetch('http://localhost:3000/api/admin/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ adminMode: 2 })
  });
  console.log('Status:', res.status);
  console.log('Response:', await res.text());
});
