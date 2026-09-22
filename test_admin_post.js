const fetch = require('node-fetch');
(async () => {
  const res = await fetch('http://127.0.0.1:3003/admin/multimovies', { // Assuming user-service is on 3003
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rootUrl: 'https://test-root.wtf/', baseUrl: 'https://test-base.wtf/' })
  });
  console.log(await res.json());
})();
