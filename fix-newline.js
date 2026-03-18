import fs from 'fs';
const path = process.argv[2];
let content = fs.readFileSync(path, 'utf8');

// Find all occurrences of } followed by /**
let idx = 0;
while ((idx = content.indexOf('}**', idx)) !== -1) {
  console.log('Found at', idx);
  // Insert newline between } and **
  content = content.slice(0, idx + 1) + '\n' + content.slice(idx + 1);
  idx++;
}

fs.writeFileSync(path, content);
console.log('Fixed in', path);
