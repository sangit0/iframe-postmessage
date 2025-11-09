#!/usr/bin/env node

/**
 * Post-build script to replace path aliases (@/) with relative imports
 * This is needed because TypeScript doesn't resolve path aliases in the output
 * Dynamically reads path aliases from tsconfig.json
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const tsconfigPath = path.join(rootDir, 'tsconfig.json');

/**
 * Reads and parses tsconfig.json to extract path aliases
 */
function getPathAliases() {
  if (!fs.existsSync(tsconfigPath)) {
    console.error('❌ tsconfig.json not found');
    process.exit(1);
  }

  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
  const compilerOptions = tsconfig.compilerOptions || {};
  const paths = compilerOptions.paths || {};
  const baseUrl = compilerOptions.baseUrl || '.';

  return { paths, baseUrl };
}

/**
 * Gets all files in dist/ directory (excluding subdirectories for now)
 */
function getDistFiles() {
  if (!fs.existsSync(distDir)) {
    return [];
  }

  const files = fs.readdirSync(distDir);
  return files
    .filter(file => {
      const filePath = path.join(distDir, file);
      return fs.statSync(filePath).isFile() && 
             (file.endsWith('.js') || file.endsWith('.d.ts'));
    })
    .map(file => file.replace(/\.(js|d\.ts)$/, ''));
}

/**
 * Builds alias map dynamically from tsconfig.json paths
 */
function buildAliasMap() {
  const { paths, baseUrl } = getPathAliases();
  const distFiles = getDistFiles();
  const aliasMap = {};

  // Process each path alias pattern
  for (const [aliasPattern, targetPaths] of Object.entries(paths)) {
    // Handle wildcard patterns like "@/*": ["./src/*"]
    if (aliasPattern.includes('*')) {
      const aliasPrefix = aliasPattern.replace('/*', '');
      const targetPrefix = targetPaths[0].replace('/*', '').replace('./src', '');
      
      // Map each file in dist/ to its alias
      distFiles.forEach(file => {
        const alias = `${aliasPrefix}/${file}`;
        const relativePath = `.${targetPrefix}/${file}`.replace(/\/+/g, '/');
        aliasMap[alias] = relativePath;
      });
    } else {
      // Handle exact matches (non-wildcard)
      const targetPath = targetPaths[0];
      const fileName = path.basename(targetPath, path.extname(targetPath));
      aliasMap[aliasPattern] = `./${fileName}`;
    }
  }

  return aliasMap;
}

function fixImportsInFile(filePath, aliasMap) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Replace all alias imports with relative paths
  for (const [alias, relativePath] of Object.entries(aliasMap)) {
    // Escape special regex characters in alias
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match both single and double quotes, and handle type imports
    const regex = new RegExp(`from ['"]${escapedAlias}['"]`, 'g');
    const typeRegex = new RegExp(`from ['"]type:${escapedAlias}['"]`, 'g');
    
    if (content.includes(alias)) {
      content = content.replace(regex, `from '${relativePath}'`);
      content = content.replace(typeRegex, `from '${relativePath}'`);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed imports in ${path.basename(filePath)}`);
  }
}

// Process all .js and .d.ts files in dist/
function processDirectory(dir, aliasMap) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath, aliasMap);
    } else if (file.endsWith('.js') || file.endsWith('.d.ts')) {
      fixImportsInFile(filePath, aliasMap);
    }
  }
}

if (fs.existsSync(distDir)) {
  const aliasMap = buildAliasMap();
  
  if (Object.keys(aliasMap).length === 0) {
    console.warn('⚠️  No path aliases found in tsconfig.json');
    process.exit(0);
  }

  console.log('📋 Found path aliases:', Object.keys(aliasMap).join(', '));
  processDirectory(distDir, aliasMap);
  console.log('✅ Import paths fixed successfully');
} else {
  console.error('❌ dist/ directory not found. Run npm run build first.');
  process.exit(1);
}

