const http = require('http');
const req = http.request({
  hostname: '127.0.0.1',
  port: 3001,
  path: '/admin/multimovies',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer DUMMY'
  }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});
req.write(JSON.stringify({ rootUrl: 'https://test-root/', baseUrl: 'https://test-base/' }));
req.end();
