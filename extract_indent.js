const fs = require('fs');
const code = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractByIndentation(funcName) {
  const lines = code.split('\n');
  const startIdx = lines.findIndex(l => l.startsWith(`function ${funcName}(`));
  if (startIdx === -1) return null;
  
  let endIdx = startIdx + 1;
  while (endIdx < lines.length) {
    if (lines[endIdx].match(/^function /) || lines[endIdx].match(/^const /) || lines[endIdx].match(/^export /)) {
      break;
    }
    endIdx++;
  }
  
  return lines.slice(startIdx, endIdx).join('\n');
}

const cfc = extractByIndentation('CollectionFilterControls');
if (cfc) {
  let content = `import React, { useState, useRef, useEffect, useMemo } from 'react';\n`;
  content += `import { createPortal } from 'react-dom';\n`;
  content += `import { AnimeFilterIcon, AnimeDropdownMenu } from './AnimeFilter.jsx';\n\n`;
  content += `export ${cfc}\n`;
  fs.writeFileSync('spa/src/components/ui/Misc/CollectionFilterControls.jsx', content);
}

const pcfc = extractByIndentation('PersonCreditsFilterControls');
if (pcfc) {
  let content = `import React, { useState, useRef, useEffect, useMemo } from 'react';\n`;
  content += `import { createPortal } from 'react-dom';\n\n`;
  content += `export ${pcfc}\n`;
  fs.writeFileSync('spa/src/components/ui/Misc/PersonCreditsFilterControls.jsx', content);
}
