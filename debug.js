const fs = require('fs');
const mainSource = fs.readFileSync('C:/Users/Rakesh Kumar/3D Objects/Soulstash/spa/src/main.jsx', 'utf8');
const s1 = mainSource.indexOf('function UserCollectionDetailPage');
const s2 = mainSource.indexOf('function AnimeFilterIcon');
console.log(mainSource.substring(s1, s1+200));
console.log(mainSource.substring(s2, s2+200));
