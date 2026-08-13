/**
 * Source Reputation Scorer — fast domain-pattern lookup.
 * Port of umbrav2's knowledge_sources.py.
 * Ranks URLs by authority tier (1=official docs, 5=unknown).
 */

const TIER_PATTERNS = [
  [1, 1.0, [
    /\.readthedocs\.io$/, /^docs\./, /^developer\.(?!mozilla\.org)/,
    /^react\.dev$/, /^web\.dev$/, /^python\.org$/, /^docs\.python\.org$/,
    /^docs\.rs$/, /^doc\.rust-lang\.org$/, /^learn\.microsoft\.com$/,
    /^cloud\.google\.com$/, /^pytorch\.org$/, /^numpy\.org$/,
    /^pandas\.pydata\.org$/, /^scikit-learn\.org$/, /^kotlinlang\.org$/,
    /^typescriptlang\.org$/, /^go\.dev$/, /^pkg\.go\.dev$/, /^swift\.org$/,
    /^angular\.io$/, /^vuejs\.org$/, /^api\./,
  ]],
  [2, 0.8, [
    /^developer\.mozilla\.org$/, /\.wikipedia\.org$/,
    /^(www\.)?rfc-editor\.org$/, /^datatracker\.ietf\.org$/,
    /^tools\.ietf\.org$/, /^en\.cppreference\.com$/, /^cppreference\.com$/,
    /^arxiv\.org$/, /^(www\.)?w3\.org$/, /^tc39\.es$/, /^peps\.python\.org$/,
  ]],
  [3, 0.6, [
    /^stackoverflow\.com$/, /^(www\.)?stackexchange\.com$/,
    /^[a-z]+\.stackexchange\.com$/, /^github\.com$/, /^gist\.github\.com$/,
    /^gitlab\.com$/, /^bitbucket\.org$/, /^discourse\./, /^discuss\./,
    /^forum\./, /^news\.ycombinator\.com$/,
  ]],
  [4, 0.4, [
    /^medium\.com$/, /^[a-z0-9-]+\.medium\.com$/, /^dev\.to$/,
    /^(www\.)?substack\.com$/, /^[a-z0-9-]+\.substack\.com$/,
    /^hashnode\.com$/, /^[a-z0-9-]+\.hashnode\.dev$/,
    /^(www\.)?freecodecamp\.org$/, /^(www\.)?geeksforgeeks\.org$/,
    /^(www\.)?tutorialspoint\.com$/, /^(www\.)?w3schools\.com$/,
    /^(www\.)?baeldung\.com$/, /^(www\.)?digitalocean\.com$/,
    /^(www\.)?towardsdatascience\.com$/, /^blog\./,
  ]],
];

const DEFAULT_TIER = 5;
const DEFAULT_SCORE = 0.2;

function extractHostname(url) {
  url = (url || '').trim();
  if (!url) return '';
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(url)) url = 'https://' + url;
  try {
    const parsed = new URL(url);
    let hostname = (parsed.hostname || '').toLowerCase().trim();
    if (hostname.startsWith('www.')) hostname = hostname.slice(4);
    return hostname;
  } catch { return ''; }
}

export function scoreSource(url) {
  const hostname = extractHostname(url);
  if (!hostname) return DEFAULT_SCORE;
  for (const [, score, patterns] of TIER_PATTERNS) {
    for (const pattern of patterns) { if (pattern.test(hostname)) return score; }
  }
  return DEFAULT_SCORE;
}

export function sourceTier(url) {
  const hostname = extractHostname(url);
  if (!hostname) return DEFAULT_TIER;
  for (const [tier, , patterns] of TIER_PATTERNS) {
    for (const pattern of patterns) { if (pattern.test(hostname)) return tier; }
  }
  return DEFAULT_TIER;
}
