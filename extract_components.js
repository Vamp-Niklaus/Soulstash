const fs = require('fs');

const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');

function extractComponent(funcName) {
  const startPattern = `function ${funcName}(`;
  let startIdx = mainSource.indexOf(startPattern);
  if (startIdx === -1) {
    console.error('Could not find', funcName);
    return null;
  }
  
  // Find the end of this component by matching the closing bracket of the function
  // We'll count brackets.
  let bracketCount = 0;
  let inFunc = false;
  let endIdx = -1;
  for (let i = startIdx; i < mainSource.length; i++) {
    if (mainSource[i] === '{') {
      if (!inFunc) {
        inFunc = true;
      }
      bracketCount++;
    } else if (mainSource[i] === '}') {
      bracketCount--;
      if (inFunc && bracketCount === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }
  
  if (endIdx === -1) {
    console.error('Could not find end of', funcName);
    return null;
  }
  
  return mainSource.slice(startIdx, endIdx);
}

const cfc = extractComponent('CollectionFilterControls');
if (cfc) {
  let content = `import React, { useState, useRef, useEffect, useMemo } from 'react';\n`;
  content += `import { createPortal } from 'react-dom';\n\n`;
  content += `export ${cfc}\n`;
  fs.writeFileSync('spa/src/components/ui/Misc/CollectionFilterControls.jsx', content);
  console.log('Wrote CollectionFilterControls.jsx');
}

const pcfc = extractComponent('PersonCreditsFilterControls');
if (pcfc) {
  let content = `import React, { useState, useRef, useEffect, useMemo } from 'react';\n`;
  content += `import { createPortal } from 'react-dom';\n\n`;
  content += `export ${pcfc}\n`;
  fs.writeFileSync('spa/src/components/ui/Misc/PersonCreditsFilterControls.jsx', content);
  console.log('Wrote PersonCreditsFilterControls.jsx');
}
