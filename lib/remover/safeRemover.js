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
      id: `gid://shopify/Theme/${themeId}`
    }
  };
}
