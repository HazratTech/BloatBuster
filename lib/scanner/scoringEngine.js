/**
 * BloatBuster - Scoring & Performance Impact Engine
 * Translates detected orphan scripts into an intuitive 0-100 Health Score,
 * estimated wasted payload weight, and page load execution delay.
 */

export function calculateBloatScore(detectedOrphans = [], unknownExternalScripts = []) {
  let score = 100;
  let totalWastedKB = 0;
  let totalDelayMs = 0;
  let highSeverityCount = 0;
  let mediumSeverityCount = 0;
  let lowSeverityCount = 0;

  for (const orphan of detectedOrphans) {
    const size = orphan.avgSizeKB || 120;
    const delay = orphan.avgDelayMs || 220;

    totalWastedKB += size;
    totalDelayMs += delay;

    if (orphan.speedPenalty === 'High') {
      score -= 15;
      highSeverityCount++;
    } else if (orphan.speedPenalty === 'Medium') {
      score -= 8;
      mediumSeverityCount++;
    } else {
      score -= 4;
      lowSeverityCount++;
    }
  }

  // Slight penalty for uncataloged unknown external scripts (approx 50KB/each)
  const unknownCount = unknownExternalScripts.length;
  if (unknownCount > 0) {
    const unknownPenalty = Math.min(unknownCount * 3, 15);
    score -= unknownPenalty;
    totalWastedKB += unknownCount * 45;
    totalDelayMs += unknownCount * 90;
  }

  // Bound score between 10 and 100
  score = Math.max(10, Math.min(100, Math.round(score)));

  let grade = 'A';
  let badgeColor = '#008060'; // Shopify Green
  let headline = 'Clean Theme Health';
  let recommendation = 'Your theme is lean and performing with minimal script overhead.';

  if (score < 60) {
    grade = 'F';
    badgeColor = '#DE3618'; // Shopify Red
    headline = 'Critical Theme Bloat Detected';
    recommendation = `You have ${detectedOrphans.length} dead scripts dragging down your mobile speed score and Google Core Web Vitals. Clean them immediately.`;
  } else if (score < 80) {
    grade = 'C';
    badgeColor = '#EEC200'; // Shopify Yellow/Amber
    headline = 'Moderate Theme Debt';
    recommendation = 'Several unused app snippets are still making network requests in the background.';
  } else if (score < 95) {
    grade = 'B';
    badgeColor = '#2C6ECB'; // Shopify Blue
    headline = 'Good - Minor Leftovers';
    recommendation = 'A few minor inactive code snippets were found. Easy quick cleanup.';
  }

  return {
    score,
    grade,
    badgeColor,
    headline,
    recommendation,
    metrics: {
      totalOrphans: detectedOrphans.length,
      highSeverityCount,
      mediumSeverityCount,
      lowSeverityCount,
      totalWastedKB: Math.round(totalWastedKB),
      estimatedDelaySeconds: +(totalDelayMs / 1000).toFixed(2),
      unknownScriptsCount: unknownCount
    }
  };
}
