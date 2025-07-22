/**
 * Project Structure Migration Script
 * 
 * This script helps migrate the project to the new structure:
 * - Creates necessary directories
 * - Moves files to their new locations
 * - Updates imports in files
 * 
 * Usage: node scripts/migrate-structure.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const SRC_DIR = path.join(__dirname, '..', 'src');
const LOG_FILE = path.join(__dirname, '..', 'migration-log.md');

// New directory structure
const NEW_STRUCTURE = {
  'assets': {
    description: 'Static assets like images, SVGs, etc.',
    files: [
      { from: 'src/Digital_Glyph_White.svg', to: 'src/assets/Digital_Glyph_White.svg' },
      { from: 'src/football.svg', to: 'src/assets/football.svg' },
      { from: 'src/Logo.png', to: 'src/assets/Logo.png' },
      { from: 'src/Logo_2.png', to: 'src/assets/Logo_2.png' },
      { from: 'src/SVG_Pelota.svg', to: 'src/assets/SVG_Pelota.svg' },
      { from: 'src/SVG_People.svg', to: 'src/assets/SVG_People.svg' }
    ]
  },
  'components/common': {
    description: 'Common UI components',
    files: [
      { from: 'src/components/Button.js', to: 'src/components/common/Button.js' },
      { from: 'src/components/LoadingSpinner.js', to: 'src/components/common/LoadingSpinner.js' },
      { from: 'src/components/LoadingSpinner.css', to: 'src/components/common/LoadingSpinner.css' },
      { from: 'src/components/Modal.js', to: 'src/components/common/Modal.js' },
      { from: 'src/components/ShareButton.js', to: 'src/components/common/ShareButton.js' },
      { from: 'src/components/WhatsappIcon.js', to: 'src/components/common/WhatsappIcon.js' },
      { from: 'src/components/MoonIcon.js', to: 'src/components/common/MoonIcon.js' },
      { from: 'src/components/SunIcon.js', to: 'src/components/common/SunIcon.js' },
      { from: 'src/components/ThemeSwitch.js', to: 'src/components/common/ThemeSwitch.js' },
      { from: 'src/components/ThemeSwitch.css', to: 'src/components/common/ThemeSwitch.css' }
    ]
  },
  'components/layout': {
    description: 'Layout components',
    files: [
      { from: 'src/components/GlobalHeader.js', to: 'src/components/layout/GlobalHeader.js' },
      { from: 'src/components/GlobalHeader.css', to: 'src/components/layout/GlobalHeader.css' },
      { from: 'src/components/TabBar.js', to: 'src/components/layout/TabBar.js' },
      { from: 'src/components/TabBar.css', to: 'src/components/layout/TabBar.css' },
      { from: 'src/components/ErrorBoundary.js', to: 'src/components/layout/ErrorBoundary.js' }
    ]
  },
  'components/match': {
    description: 'Match-related components',
    files: [
      { from: 'src/PartidoInfoBox.js', to: 'src/components/match/PartidoInfoBox.js' },
      { from: 'src/FormularioNuevoPartidoFlow.js', to: 'src/components/match/FormularioNuevoPartidoFlow.js' },
      { from: 'src/FormularioNuevoPartidoFlow.css', to: 'src/components/match/FormularioNuevoPartidoFlow.css' },
      { from: 'src/EditarPartidoFrecuente.js', to: 'src/components/match/EditarPartidoFrecuente.js' },
      { from: 'src/EditarPartidoFrecuente.css', to: 'src/components/match/EditarPartidoFrecuente.css' },
      { from: 'src/ListaPartidosFrecuentes.js', to: 'src/components/match/ListaPartidosFrecuentes.js' },
      { from: 'src/components/MatchChat.js', to: 'src/components/match/MatchChat.js' },
      { from: 'src/components/MatchChat.css', to: 'src/components/match/MatchChat.css' },
      { from: 'src/components/ChatButton.js', to: 'src/components/match/ChatButton.js' },
      { from: 'src/components/ChatButton.css', to: 'src/components/match/ChatButton.css' }
    ]
  },
  'components/player': {
    description: 'Player-related components',
    files: [
      { from: 'src/components/PlayerCard.js', to: 'src/components/player/PlayerCard.js' },
      { from: 'src/components/PlayerCard.css', to: 'src/components/player/PlayerCard.css' },
      { from: 'src/components/PlayerCardTrigger.js', to: 'src/components/player/PlayerCardTrigger.js' },
      { from: 'src/components/PlayerCardTrigger.css', to: 'src/components/player/PlayerCardTrigger.css' },
      { from: 'src/components/PlayerForm.js', to: 'src/components/player/PlayerForm.js' },
      { from: 'src/components/PlayerList.js', to: 'src/components/player/PlayerList.js' },
      { from: 'src/components/PlayerAwards.js', to: 'src/components/player/PlayerAwards.js' },
      { from: 'src/components/PlayerAwards.css', to: 'src/components/player/PlayerAwards.css' },
      { from: 'src/components/ProfileCard.js', to: 'src/components/player/ProfileCard.js' },
      { from: 'src/components/ProfileCard.css', to: 'src/components/player/ProfileCard.css' },
      { from: 'src/components/ProfileCardModal.js', to: 'src/components/player/ProfileCardModal.js' },
      { from: 'src/components/ProfileCardModal.css', to: 'src/components/player/ProfileCardModal.css' },
      { from: 'src/components/ProfileEditor.js', to: 'src/components/player/ProfileEditor.js' },
      { from: 'src/components/ProfileEditor.css', to: 'src/components/player/ProfileEditor.css' },
      { from: 'src/components/ProfileDisplay.js', to: 'src/components/player/ProfileDisplay.js' },
      { from: 'src/components/AvatarWithProgress.js', to: 'src/components/player/AvatarWithProgress.js' },
      { from: 'src/components/AvatarWithProgress.css', to: 'src/components/player/AvatarWithProgress.css' },
      { from: 'src/components/CameraUpload.js', to: 'src/components/player/CameraUpload.js' }
    ]
  },
  'components/teams': {
    description: 'Team-related components',
    files: [
      { from: 'src/components/TeamDisplay.js', to: 'src/components/teams/TeamDisplay.js' },
      { from: 'src/components/TeamDisplay.css', to: 'src/components/teams/TeamDisplay.css' },
      { from: 'src/components/TeamGenerator.js', to: 'src/components/teams/TeamGenerator.js' },
      { from: 'src/components/EditableTeamName.css', to: 'src/components/teams/EditableTeamName.css' }
    ]
  },
  'components/voting': {
    description: 'Voting-related components',
    files: [
      { from: 'src/VotingView.js', to: 'src/components/voting/VotingView.js' },
      { from: 'src/VotingView.css', to: 'src/components/voting/VotingView.css' },
      { from: 'src/StarRating.js', to: 'src/components/voting/StarRating.js' },
      { from: 'src/StarRating.css', to: 'src/components/voting/StarRating.css' }
    ]
  },
  'pages': {
    description: 'Page components',
    files: [
      { from: 'src/AdminPanel.js', to: 'src/pages/AdminPanel.js' },
      { from: 'src/AdminPanel.css', to: 'src/pages/AdminPanel.css' },
      { from: 'src/FifaHome.js', to: 'src/pages/FifaHome.js' },
      { from: 'src/QuieroJugar.js', to: 'src/pages/QuieroJugar.js' },
      { from: 'src/QuieroJugar.css', to: 'src/pages/QuieroJugar.css' },
      { from: 'src/IngresoAdminPartido.js', to: 'src/pages/IngresoAdminPartido.js' },
      { from: 'src/IngresoAdminPartido.css', to: 'src/pages/IngresoAdminPartido.css' },
      { from: 'src/IngresoVotacion.js', to: 'src/pages/IngresoVotacion.js' },
      { from: 'src/IngresoVotacion.css', to: 'src/pages/IngresoVotacion.css' },
      { from: 'src/JugadorIngresarCodigo.js', to: 'src/pages/JugadorIngresarCodigo.js' },
      { from: 'src/RegistroJugador.js', to: 'src/pages/RegistroJugador.js' },
      { from: 'src/SeleccionarTipoPartido.js', to: 'src/pages/SeleccionarTipoPartido.js' }
    ]
  },
  'styles': {
    description: 'Global styles',
    files: [
      { from: 'src/App.css', to: 'src/styles/App.css' },
      { from: 'src/HomeStyleKit.css', to: 'src/styles/HomeStyleKit.css' },
      { from: 'src/FrecuentesStyle.css', to: 'src/styles/FrecuentesStyle.css' },
      { from: 'src/PanelPartido.css', to: 'src/styles/PanelPartido.css' },
      { from: 'src/styles.css', to: 'src/styles/global.css' }
    ]
  },
  'utils': {
    description: 'Utility functions',
    files: [
      { from: 'src/utils.js', to: 'src/utils/teamUtils.js' },
      { from: 'src/SvgPelota.js', to: 'src/utils/SvgPelota.js' },
      { from: 'src/SvgPeople.js', to: 'src/utils/SvgPeople.js' },
      { from: 'src/AutocompleteSede.js', to: 'src/utils/AutocompleteSede.js' }
    ]
  }
};

// Helper functions
function createDirectories() {
  console.log('Creating directories...');
  
  Object.keys(NEW_STRUCTURE).forEach(dir => {
    const fullPath = path.join(SRC_DIR, dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(`Created directory: ${fullPath}`);
    }
  });
}

function copyFiles() {
  console.log('Copying files to new locations...');
  
  const copied = [];
  const failed = [];
  
  Object.keys(NEW_STRUCTURE).forEach(dir => {
    const files = NEW_STRUCTURE[dir].files || [];
    
    files.forEach(file => {
      const sourcePath = path.join(__dirname, '..', file.from);
      const targetPath = path.join(__dirname, '..', file.to);
      
      try {
        if (fs.existsSync(sourcePath)) {
          // Create target directory if it doesn't exist
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          // Copy the file
          fs.copyFileSync(sourcePath, targetPath);
          copied.push({ from: file.from, to: file.to });
          console.log(`Copied: ${file.from} -> ${file.to}`);
        } else {
          failed.push({ file: file.from, reason: 'Source file not found' });
          console.warn(`Warning: Source file not found: ${file.from}`);
        }
      } catch (error) {
        failed.push({ file: file.from, reason: error.message });
        console.error(`Error copying ${file.from}: ${error.message}`);
      }
    });
  });
  
  return { copied, failed };
}

function generateReport(results) {
  console.log('Generating migration report...');
  
  let report = `# Project Structure Migration Report\n\n`;
  report += `Generated on: ${new Date().toLocaleString()}\n\n`;
  
  report += `## Summary\n\n`;
  report += `- Directories created: ${Object.keys(NEW_STRUCTURE).length}\n`;
  report += `- Files copied: ${results.copied.length}\n`;
  report += `- Files failed: ${results.failed.length}\n\n`;
  
  report += `## New Directory Structure\n\n`;
  Object.keys(NEW_STRUCTURE).forEach(dir => {
    report += `### src/${dir}\n\n`;
    report += `${NEW_STRUCTURE[dir].description}\n\n`;
    
    const files = NEW_STRUCTURE[dir].files || [];
    if (files.length > 0) {
      report += `Files moved to this directory:\n\n`;
      files.forEach(file => {
        const success = results.copied.some(f => f.from === file.from && f.to === file.to);
        report += `- ${file.from} -> ${file.to} ${success ? '✅' : '❌'}\n`;
      });
      report += `\n`;
    }
  });
  
  if (results.failed.length > 0) {
    report += `## Failed Files\n\n`;
    results.failed.forEach(failure => {
      report += `- ${failure.file}: ${failure.reason}\n`;
    });
    report += `\n`;
  }
  
  report += `## Next Steps\n\n`;
  report += `1. Update imports in all files to use the new paths\n`;
  report += `2. Test the application to ensure everything works correctly\n`;
  report += `3. Once confirmed working, remove the original files\n`;
  
  fs.writeFileSync(LOG_FILE, report);
  console.log(`Report generated at ${LOG_FILE}`);
}

// Main function
function migrateStructure() {
  console.log('Starting project structure migration...');
  
  createDirectories();
  const results = copyFiles();
  generateReport(results);
  
  console.log('Migration completed!');
  console.log(`- ${results.copied.length} files copied`);
  console.log(`- ${results.failed.length} files failed`);
  console.log(`See ${LOG_FILE} for details`);
}

// Run the migration
migrateStructure();