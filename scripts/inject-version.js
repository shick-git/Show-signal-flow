#!/usr/bin/env node
// Reads version from package.json and patches the web-fallback in app.js
// Run automatically via npm "prebuild" / "prestart" hooks

const fs  = require('fs');
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const ver = pkg.version;

let src = fs.readFileSync('./app.js', 'utf8');
const updated = src.replace(/: 'v[\d]+\.[\d]+\.[\d]+';/, `: 'v${ver}';`);

if (src === updated) {
  console.log(`[inject-version] app.js already at v${ver}`);
} else {
  fs.writeFileSync('./app.js', updated, 'utf8');
  console.log(`[inject-version] app.js → v${ver}`);
}
