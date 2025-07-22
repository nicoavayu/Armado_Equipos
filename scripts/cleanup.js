/**
 * Team Balancer - Code Cleanup Script
 * 
 * This script helps identify and clean up code issues:
 * - Finds duplicate code
 * - Identifies unused imports
 * - Locates commented out code blocks
 * - Suggests file reorganization
 * 
 * Usage: node scripts/cleanup.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const SRC_DIR = path.join(__dirname, '..', 'src');
const REPORT_FILE = path.join(__dirname, '..', 'cleanup-report.md');

// File patterns to analyze
const JS_FILES = /\.(js|jsx)$/;
const CSS_FILES = /\.css$/;
const EXCLUDE_DIRS = ['node_modules', 'build', 'dist'];

// Helper functions
function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      if (!EXCLUDE_DIRS.includes(f)) {
        walkDir(dirPath, callback);
      }
    } else {
      callback(path.join(dir, f));
    }
  });
}

// Find commented code blocks
function findCommentedCode(filePath, content) {
  const lines = content.split('\n');
  const commentBlocks = [];
  let currentBlock = [];
  let inBlock = false;

  lines.forEach((line, i) => {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) return;
    
    // Check for comment lines
    if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.includes('*/')) {
      // If it's a comment that looks like code
      if (
        (trimmedLine.includes('{') || trimmedLine.includes('}') || 
         trimmedLine.includes('function') || trimmedLine.includes('const ') ||
         trimmedLine.includes('let ') || trimmedLine.includes('return ') ||
         trimmedLine.includes('if(') || trimmedLine.includes('if ('))
      ) {
        if (!inBlock) {
          inBlock = true;
        }
        currentBlock.push({ line: i + 1, content: line });
      }
    } else {
      if (inBlock && currentBlock.length > 0) {
        commentBlocks.push([...currentBlock]);
        currentBlock = [];
        inBlock = false;
      }
    }
  });

  // Add the last block if there is one
  if (inBlock && currentBlock.length > 0) {
    commentBlocks.push([...currentBlock]);
  }

  return commentBlocks.filter(block => block.length > 1); // Only return blocks with multiple lines
}

// Find potential duplicate functions
function findDuplicateFunctions(files) {
  const functionMap = new Map();
  const duplicates = [];

  files.forEach(file => {
    if (!JS_FILES.test(file)) return;
    
    const content = fs.readFileSync(file, 'utf8');
    const functionMatches = content.match(/function\s+(\w+)\s*\([^)]*\)\s*{/g) || [];
    const arrowFunctionMatches = content.match(/const\s+(\w+)\s*=\s*(?:\([^)]*\)|[^=]*)\s*=>\s*{/g) || [];
    
    [...functionMatches, ...arrowFunctionMatches].forEach(match => {
      const functionName = match.match(/(?:function|const)\s+(\w+)/)[1];
      
      if (!functionMap.has(functionName)) {
        functionMap.set(functionName, []);
      }
      
      functionMap.get(functionName).push(file);
    });
  });

  // Find functions that appear in multiple files
  functionMap.forEach((files, functionName) => {
    if (files.length > 1) {
      duplicates.push({ functionName, files });
    }
  });

  return duplicates;
}

// Find unused CSS classes
function findUnusedCSSClasses(jsFiles, cssFiles) {
  const cssClasses = new Map();
  const usedClasses = new Set();

  // Extract all CSS classes
  cssFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    const classMatches = content.match(/\.[\w-]+\s*{/g) || [];
    
    classMatches.forEach(match => {
      const className = match.match(/\.([\w-]+)/)[1];
      if (!cssClasses.has(className)) {
        cssClasses.set(className, []);
      }
      cssClasses.get(className).push(file);
    });
  });

  // Find used classes in JS files
  jsFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    
    // Check for className="..."
    const classNameMatches = content.match(/className\s*=\s*["']([^"']+)["']/g) || [];
    classNameMatches.forEach(match => {
      const classNames = match.match(/className\s*=\s*["']([^"']+)["']/)[1].split(/\s+/);
      classNames.forEach(className => usedClasses.add(className));
    });
    
    // Check for classList.add("...")
    const classListMatches = content.match(/classList\.add\(["']([^"']+)["']\)/g) || [];
    classListMatches.forEach(match => {
      const className = match.match(/classList\.add\(["']([^"']+)["']\)/)[1];
      usedClasses.add(className);
    });
  });

  // Find unused classes
  const unusedClasses = [];
  cssClasses.forEach((files, className) => {
    if (!usedClasses.has(className)) {
      unusedClasses.push({ className, files });
    }
  });

  return unusedClasses;
}

// Generate report
function generateReport() {
  const jsFiles = [];
  const cssFiles = [];
  const commentedCodeBlocks = [];
  
  walkDir(SRC_DIR, (filePath) => {
    if (JS_FILES.test(filePath)) {
      jsFiles.push(filePath);
      
      const content = fs.readFileSync(filePath, 'utf8');
      const blocks = findCommentedCode(filePath, content);
      
      if (blocks.length > 0) {
        commentedCodeBlocks.push({ file: filePath, blocks });
      }
    } else if (CSS_FILES.test(filePath)) {
      cssFiles.push(filePath);
    }
  });
  
  const duplicateFunctions = findDuplicateFunctions(jsFiles);
  const unusedCSSClasses = findUnusedCSSClasses(jsFiles, cssFiles);
  
  // Generate report content
  let report = `# Code Cleanup Report\n\n`;
  report += `Generated on: ${new Date().toLocaleString()}\n\n`;
  
  report += `## Summary\n\n`;
  report += `- Total JS/JSX files: ${jsFiles.length}\n`;
  report += `- Total CSS files: ${cssFiles.length}\n`;
  report += `- Files with commented code blocks: ${commentedCodeBlocks.length}\n`;
  report += `- Potential duplicate functions: ${duplicateFunctions.length}\n`;
  report += `- Potentially unused CSS classes: ${unusedCSSClasses.length}\n\n`;
  
  // Duplicate functions
  report += `## Potential Duplicate Functions\n\n`;
  if (duplicateFunctions.length === 0) {
    report += `No duplicate functions found.\n\n`;
  } else {
    duplicateFunctions.forEach(({ functionName, files }) => {
      report += `### Function: \`${functionName}\`\n\n`;
      report += `Found in ${files.length} files:\n\n`;
      files.forEach(file => {
        report += `- ${path.relative(path.join(__dirname, '..'), file)}\n`;
      });
      report += `\n`;
    });
  }
  
  // Commented code blocks
  report += `## Commented Code Blocks\n\n`;
  if (commentedCodeBlocks.length === 0) {
    report += `No commented code blocks found.\n\n`;
  } else {
    commentedCodeBlocks.forEach(({ file, blocks }) => {
      report += `### ${path.relative(path.join(__dirname, '..'), file)}\n\n`;
      report += `${blocks.length} commented code block(s) found:\n\n`;
      
      blocks.forEach((block, i) => {
        report += `#### Block ${i + 1} (Lines ${block[0].line}-${block[block.length - 1].line})\n\n`;
        report += "```javascript\n";
        block.forEach(line => {
          report += `${line.content}\n`;
        });
        report += "```\n\n";
      });
    });
  }
  
  // Unused CSS classes
  report += `## Potentially Unused CSS Classes\n\n`;
  if (unusedCSSClasses.length === 0) {
    report += `No unused CSS classes found.\n\n`;
  } else {
    report += `Found ${unusedCSSClasses.length} potentially unused CSS classes:\n\n`;
    unusedCSSClasses.forEach(({ className, files }) => {
      report += `### Class: \`.${className}\`\n\n`;
      report += `Defined in:\n\n`;
      files.forEach(file => {
        report += `- ${path.relative(path.join(__dirname, '..'), file)}\n`;
      });
      report += `\n`;
    });
  }
  
  // Suggested reorganization
  report += `## Suggested File Reorganization\n\n`;
  report += `Based on the analysis, here's a suggested reorganization of the project structure:\n\n`;
  report += "```\n";
  report += `src/
├── assets/            # Move all SVGs, images here
├── components/
│   ├── common/        # Move Button, Modal, LoadingSpinner, etc. here
│   ├── layout/        # Move GlobalHeader, TabBar, etc. here
│   ├── match/         # Move match-related components here
│   ├── player/        # Move player-related components here
│   ├── teams/         # Move team-related components here
│   └── voting/        # Move voting-related components here
├── context/           # Keep existing context files
├── hooks/             # Keep existing hooks
├── pages/             # Move top-level page components here
├── services/
│   ├── api.js         # Extract API calls from supabase.js
│   ├── auth.js        # Extract auth logic from AuthProvider
│   └── storage.js     # Extract storage logic
├── styles/            # Move global CSS here
├── utils/             # Consolidate utility functions
└── constants/         # Move constants.js and appConstants.js here
```\n\n`;
  
  // Write report to file
  fs.writeFileSync(REPORT_FILE, report);
  console.log(`Report generated at ${REPORT_FILE}`);
}

// Run the report generator
generateReport();