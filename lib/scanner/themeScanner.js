/**
 * BloatBuster - Theme Code & Liquid Scanner
 * Scans theme files (layout/theme.liquid, snippets/, settings_data.json)
 * Pinpoints exact line numbers, code snippets, and active app embeds.
 */

import signaturesData from '../../data/signatures.json' with { type: 'json' };

/**
 * Extracts active App Embed blocks from config/settings_data.json
 * and maps them to known app IDs in our database.
 */
export function extractActiveAppBlocks(settingsDataJson) {
  const activeBlockTypes = [];
  const recognizedActiveAppIds = new Set();

  try {
    const data = typeof settingsDataJson === 'string' ? JSON.parse(settingsDataJson) : settingsDataJson;
    const currentBlocks = data?.current?.blocks || {};

    for (const [blockId, blockConfig] of Object.entries(currentBlocks)) {
      // In Shopify OS 2.0, app blocks have types like 'shopify://apps/{app-handle}/blocks/...'
      if (blockConfig?.type && !blockConfig.disabled) {
        activeBlockTypes.push({
          id: blockId,
          type: blockConfig.type
        });

        // Match against known app domain/id patterns
        const typeLower = blockConfig.type.toLowerCase();
        for (const app of signaturesData.apps) {
          const appSlug = app.id.replace(/_/g, '-');
          if (
            typeLower.includes(app.id) ||
            typeLower.includes(appSlug) ||
            app.domainPatterns.some(p => typeLower.includes(p.replace(/\..*$/, '')))
          ) {
            recognizedActiveAppIds.add(app.id);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to parse settings_data.json:', err.message);
  }

  return {
    activeBlocks: activeBlockTypes,
    activeAppIds: Array.from(recognizedActiveAppIds)
  };
}

/**
 * Scans a single Liquid file (e.g. layout/theme.liquid) line-by-line
 */
export function scanLiquidFile(filePath, content, activeAppHandles = []) {
  const lines = content.split(/\r?\n/);
  const findings = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const lineText = lines[i];

    // Check for Liquid render/include tags
    // e.g. {% render 'klaviyo' %} or {% include 'loox' %}
    const liquidTagRegex = /{%\s*(render|include)\s+['"]([^'"]+)['"]/gi;
    let liquidMatch;

    while ((liquidMatch = liquidTagRegex.exec(lineText)) !== null) {
      const tagType = liquidMatch[1]; // 'render' or 'include'
      const snippetName = liquidMatch[2]; // e.g. 'klaviyo', 'judgeme_widgets'

      // Check if this snippet matches a known app
      for (const app of signaturesData.apps) {
        const matchesSnippet = app.snippetPatterns.some(pattern => {
          const cleanPattern = pattern.replace('snippets/', '').replace('.liquid', '');
          return snippetName.toLowerCase().includes(cleanPattern.toLowerCase());
        });

        if (matchesSnippet) {
          const isConfirmedActive = activeAppHandles.includes(app.id);
          findings.push({
            appId: app.id,
            appName: app.name,
            filePath,
            line: lineNum,
            codeSnippet: lineText.trim(),
            tagType,
            snippetName,
            status: isConfirmedActive ? 'active' : 'suspected_orphan',
            speedPenalty: app.speedPenalty,
            cleanupAdvice: app.cleanupAdvice
          });
        }
      }
    }

    // Check for inline script tags containing domain or inline patterns
    for (const app of signaturesData.apps) {
      for (const pattern of app.domainPatterns) {
        if (lineText.toLowerCase().includes(pattern.toLowerCase())) {
          const isConfirmedActive = activeAppHandles.includes(app.id);
          // Avoid duplicate findings on the same line for the same app
          if (!findings.some(f => f.line === lineNum && f.appId === app.id)) {
            findings.push({
              appId: app.id,
              appName: app.name,
              filePath,
              line: lineNum,
              codeSnippet: lineText.trim(),
              tagType: 'inline_reference',
              matchedPattern: pattern,
              status: isConfirmedActive ? 'active' : 'suspected_orphan',
              speedPenalty: app.speedPenalty,
              cleanupAdvice: app.cleanupAdvice
            });
          }
        }
      }
    }
  }

  return findings;
}

/**
 * Scans a list of theme snippet filenames (e.g. snippets/klaviyo.liquid)
 */
export function scanSnippetFilenames(snippetFilenames, activeAppHandles = []) {
  const orphanSnippetFiles = [];

  for (const filename of snippetFilenames) {
    const cleanFilename = filename.toLowerCase().replace('snippets/', '');

    for (const app of signaturesData.apps) {
      const matches = app.snippetPatterns.some(pattern => {
        const cleanPattern = pattern.toLowerCase().replace('snippets/', '');
        return cleanFilename.includes(cleanPattern);
      });

      if (matches) {
        const isConfirmedActive = activeAppHandles.includes(app.id);
        orphanSnippetFiles.push({
          appId: app.id,
          appName: app.name,
          filePath: filename.startsWith('snippets/') ? filename : `snippets/${filename}`,
          status: isConfirmedActive ? 'active' : 'suspected_orphan',
          speedPenalty: app.speedPenalty,
          cleanupAdvice: `Delete this unneeded snippet file (${filename}) from your theme.`
        });
      }
    }
  }

  return orphanSnippetFiles;
}

/**
 * Deep Native Theme Asset Audit
 * Cross-references active app embeds, layout/theme.liquid tags, and orphaned snippet files.
 */
export function auditThemeAssets(themeAssetKeys = [], themeLiquidContent = '', settingsDataJson = null, activeOverrides = []) {
  const { activeAppIds } = settingsDataJson ? extractActiveAppBlocks(settingsDataJson) : { activeAppIds: [] };
  const combinedActiveApps = Array.from(new Set([...activeAppIds, ...activeOverrides]));

  const liquidFindings = themeLiquidContent ? scanLiquidFile('layout/theme.liquid', themeLiquidContent, combinedActiveApps) : [];
  const snippetFiles = themeAssetKeys.filter(k => k.startsWith('snippets/'));
  const snippetFindings = scanSnippetFilenames(snippetFiles, combinedActiveApps);

  const orphanLiquidFindings = liquidFindings.filter(f => f.status === 'suspected_orphan');
  const orphanSnippetFiles = snippetFindings.filter(s => s.status === 'suspected_orphan');
  const verifiedActiveFindings = liquidFindings.filter(f => f.status === 'active');

  return {
    activeAppIds: combinedActiveApps,
    liquidFindings,
    snippetFindings,
    orphanLiquidFindings,
    orphanSnippetFiles,
    verifiedActiveFindings,
    summary: {
      totalLiquidFindings: liquidFindings.length,
      totalSnippetFilesFound: snippetFindings.length,
      totalOrphanReferences: orphanLiquidFindings.length + orphanSnippetFiles.length,
      verifiedActiveCount: combinedActiveApps.length
    }
  };
}

