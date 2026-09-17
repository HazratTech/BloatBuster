/**
 * BloatBuster - Safe Remover & Excision Protocol
 * Generates manual removal instructions with direct Shopify Code Editor deep links,
 * safe commenting syntax, and Shopify GraphQL theme duplicate backup mutations.
 */

/**
 * Builds direct deep link to the Shopify Admin Theme Code Editor for an exact file
 */
export function buildThemeEditorDeepLink(shopDomain, themeId, filePath) {
  const cleanShop = shopDomain.replace('.myshopify.com', '').replace(/^https?:\/\//, '');
  const cleanThemeId = themeId || 'current';
  return `https://admin.shopify.com/store/${cleanShop}/themes/${cleanThemeId}/editor?key=${encodeURIComponent(filePath)}`;
}

/**
 * Wraps a line of dead liquid code in a safe comment block instead of deleting it outright
 */
export function safelyCommentOutCode(codeLine, appName = 'Uninstalled App') {
  const trimmed = codeLine.trim();
  const timestamp = new Date().toISOString().split('T')[0];
  return `{%- comment -%} [BloatBuster Safe Clean ${timestamp}] Removed ${appName}: ${trimmed} {%- endcomment -%}`;
}

/**
 * Generates step-by-step manual removal instructions for Free Tier merchants
 */
export function generateExcisionGuide(finding, shopDomain, themeId) {
  const editorUrl = buildThemeEditorDeepLink(shopDomain, themeId, finding.filePath);

  return {
    appName: finding.appName,
    filePath: finding.filePath,
    line: finding.line,
    originalCode: finding.codeSnippet,
    safeReplacementCode: safelyCommentOutCode(finding.codeSnippet, finding.appName),
    editorDeepLink: editorUrl,
    steps: [
      `1. Open ${finding.filePath} in your Shopify Theme Code Editor.`,
      `2. Jump to Line ${finding.line || 'search for ' + finding.snippetName}.`,
      `3. Delete the line: ${finding.codeSnippet} (or replace it with safe comment).`,
      `4. Click 'Save' in the top right corner.`
    ]
  };
}

/**
 * Generates GraphQL mutation payload to duplicate theme before automated cleanup (Pro Tier)
 */
export function buildThemeDuplicateMutation(themeId) {
  const cleanId = String(themeId).replace(/\D/g, '');
  return {
    query: `
      mutation DuplicateTheme($id: ID!) {
        themeDuplicate(id: $id) {
          createdTheme {
            id
            name
            role
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    variables: {
      id: `gid://shopify/OnlineStoreTheme/${cleanId}`
    }
  };
}

/**
 * Programmatically comments out a dead snippet or line in raw Liquid content
 */
export function applySafeCommentToLiquid(originalLiquid, targetSnippetOrLine, appName = 'Uninstalled App') {
  if (!originalLiquid || !targetSnippetOrLine) {
    return { success: false, error: 'Missing liquid content or target line.' };
  }

  const trimmedTarget = targetSnippetOrLine.trim();
  const safeReplacement = safelyCommentOutCode(trimmedTarget, appName);

  // If already commented by BloatBuster, avoid double-wrapping
  if (originalLiquid.includes(safeReplacement)) {
    return { success: true, updatedLiquid: originalLiquid, alreadyCommented: true };
  }

  // Look for exact line or line containing target
  const lines = originalLiquid.split(/\r?\n/);
  let replaced = false;

  const newLines = lines.map(line => {
    if (!replaced && line.trim().includes(trimmedTarget)) {
      replaced = true;
      // Preserve original indentation
      const indent = line.match(/^\s*/)?.[0] || '';
      return `${indent}${safeReplacement}`;
    }
    return line;
  });

  if (!replaced) {
    return {
      success: false,
      error: `Could not pinpoint target line in theme.liquid: "${trimmedTarget}"`
    };
  }

  return {
    success: true,
    updatedLiquid: newLines.join('\n'),
    alreadyCommented: false
  };
}

