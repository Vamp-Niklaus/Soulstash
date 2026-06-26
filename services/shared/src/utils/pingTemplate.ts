export interface PingConfig {
  serviceName: string;
  role: string;
  parents: string[];
  children: string[];
  endpoints: string[];
}

export function generatePingHtml(config: PingConfig): string {
  const parentsHtml = config.parents.length 
    ? config.parents.map(p => `<li><span class="dot parent-dot"></span>${p}</li>`).join('') 
    : '<li>None (Top Level)</li>';
    
  const childrenHtml = config.children.length 
    ? config.children.map(c => `<li><span class="dot child-dot"></span>${c}</li>`).join('') 
    : '<li>None (Bottom Level)</li>';
    
  const endpointsHtml = config.endpoints.length 
    ? config.endpoints.map(e => `<span class="endpoint-badge">${e}</span>`).join('') 
    : '<span>No public endpoints</span>';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.serviceName} - Soulstash Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(20, 27, 45, 0.7);
      --card-border: rgba(255, 255, 255, 0.1);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #3b82f6;
      --success: #10b981;
      --parent: #8b5cf6;
      --child: #f59e0b;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 2rem;
      background-image: 
        radial-gradient(circle at 15% 50%, rgba(59, 130, 246, 0.15), transparent 25%),
        radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.15), transparent 25%);
    }

    .dashboard {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 16px;
      padding: 2.5rem;
      width: 100%;
      max-width: 650px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      animation: fade-in 0.6s ease-out;
    }

    @keyframes fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
    }

    .title-group h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
      letter-spacing: -0.025em;
    }

    .title-group p {
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.5;
      max-width: 400px;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      padding: 0.5rem 1rem;
      border-radius: 999px;
      font-size: 0.875rem;
      font-weight: 500;
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .pulse {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
      animation: pulse-dot 2s infinite;
    }

    @keyframes pulse-dot {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .section h3 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 1rem;
    }

    .list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .list li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.95rem;
      background: rgba(0,0,0,0.2);
      padding: 0.6rem 0.8rem;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.05);
    }

    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .parent-dot { background-color: var(--parent); }
    .child-dot { background-color: var(--child); }

    .endpoints-container {
      background: rgba(0,0,0,0.2);
      padding: 1.25rem;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.05);
    }

    .endpoints-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .endpoint-badge {
      background: rgba(59, 130, 246, 0.15);
      color: #93c5fd;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.85rem;
      border: 1px solid rgba(59, 130, 246, 0.3);
      transition: all 0.2s ease;
    }
    
    .endpoint-badge:hover {
      background: rgba(59, 130, 246, 0.25);
      border-color: rgba(59, 130, 246, 0.5);
    }

    @media (max-width: 600px) {
      .grid { grid-template-columns: 1fr; }
      .header { flex-direction: column; gap: 1rem; }
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="header">
      <div class="title-group">
        <h1>${config.serviceName}</h1>
        <p>${config.role}</p>
      </div>
      <div class="status-badge">
        <div class="pulse"></div>
        Service Online
      </div>
    </div>

    <div class="grid">
      <div class="section">
        <h3>Called By (Parents)</h3>
        <ul class="list">
          ${parentsHtml}
        </ul>
      </div>
      
      <div class="section">
        <h3>Calls To (Children)</h3>
        <ul class="list">
          ${childrenHtml}
        </ul>
      </div>
    </div>

    <div class="section">
      <h3>Active Endpoints</h3>
      <div class="endpoints-container">
        <div class="endpoints-grid">
          ${endpointsHtml}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
