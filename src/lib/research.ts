/**
 * Research utilities powered by Jina AI Reader API
 * - Web search via DuckDuckGo HTML
 * - Content extraction from any URL
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ExtractedContent {
  title: string;
  text: string;
  links: { text: string; url: string }[];
  images: string[];
}

/**
 * Search the web using DuckDuckGo via Jina AI Reader
 * API: https://r.jina.ai/http://html.duckduckgo.com/html?q=QUERY
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://r.jina.ai/http://html.duckduckgo.com/html?q=${encoded}`;

  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseSearchResults(html, query);
}

/**
 * Extract readable content from a URL using Jina AI Reader
 * API: https://r.jina.ai/URL
 */
export async function extractUrl(url: string): Promise<ExtractedContent> {
  const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
  const jinaUrl = `https://r.jina.ai/${encodeURIComponent(cleanUrl)}`;

  const response = await fetch(jinaUrl, {
    headers: {
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Extraction failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  return parseExtractedContent(html, cleanUrl);
}

/**
 * Parse DuckDuckGo HTML search results
 */
function parseSearchResults(html: string, query: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks in DuckDuckGo HTML
  const resultRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)">([^<]+)<\/a>[\s\S]*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]+>([\s\S]*?)<\/a>/gi;
  const titleRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+>([^<]+)<\/a>/gi;
  const linkRegex = /href="([^"]+)"/gi;
  const snippetRegex = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>>([\s\S]*?)<\/a>/gi;
  const urlRegex = /<div[^>]+class="[^"]*result__url[^"]*"[^>]+>([^<]+)<\/div>/gi;

  // Simpler parser: look for result block patterns
  const blocks = html.split(/<div[^>]+class="[^"]*result__body[^"]*"[^>]*>/i);

  for (const block of blocks.slice(1, 11)) {
    // Parse up to 10 results
    try {
      const linkMatch = block.match(/href="([^"]+)"/);
      const titleMatch = block.match(/class="[^"]*result__a[^"]*"[^>]*>([^<]+)</);
      const snippetMatch = block.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)</);

      if (linkMatch && titleMatch) {
        let url = decodeURIComponent(linkMatch[1]);
        // Clean DuckDuckGo redirect
        if (url.includes("uddg=")) {
          const uddgMatch = url.match(/uddg=([^&]+)/);
          if (uddgMatch) {
            url = decodeURIComponent(uddgMatch[1]);
          }
        }

        results.push({
          title: cleanHtml(titleMatch[1]),
          url: url,
          snippet: snippetMatch ? cleanHtml(snippetMatch[1]).slice(0, 200) : "",
        });
      }
    } catch {
      continue;
    }
  }

  return results;
}

/**
 * Parse extracted HTML content
 */
function parseExtractedContent(html: string, sourceUrl: string): ExtractedContent {
  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch ? cleanHtml(titleMatch[1]) : "";

  // Extract main content - try various selectors
  let text = "";

  // Try to find main content area
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) {
    text = cleanHtml(mainMatch[1]);
  } else {
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      text = cleanHtml(articleMatch[1]);
    } else {
      // Fallback: get body text
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      text = bodyMatch ? cleanHtml(bodyMatch[1]) : html;
    }
  }

  // Extract links
  const links: { text: string; url: string }[] = [];
  const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null && links.length < 20) {
    try {
      const href = decodeURIComponent(linkMatch[1]);
      if (href.startsWith("http")) {
        links.push({
          text: cleanHtml(linkMatch[2]),
          url: href,
        });
      }
    } catch {
      continue;
    }
  }

  // Extract images
  const images: string[] = [];
  const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null && images.length < 10) {
    try {
      const src = decodeURIComponent(imgMatch[1]);
      if (src.startsWith("http")) {
        images.push(src);
      }
    } catch {
      continue;
    }
  }

  return { title, text: text.slice(0, 10000), links, images };
}

/**
 * Clean HTML tags and decode entities
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#\d+;/g, "") // Remove numeric entities
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Format search results for display
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  return results
    .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
    .join("\n\n");
}

/**
 * Format extracted content for display
 */
export function formatExtractedContent(content: ExtractedContent): string {
  let output = `# ${content.title}\n\n`;

  if (content.text) {
    output += content.text.slice(0, 5000);
    if (content.text.length > 5000) {
      output += "\n\n...[truncated]";
    }
  }

  if (content.links.length > 0) {
    output += "\n\n## Links\n";
    content.links.slice(0, 10).forEach((link) => {
      output += `\n- [${link.text}](${link.url})`;
    });
  }

  return output;
}