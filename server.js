import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "public");
const articlesDir = join(rootDir, "articles");
const port = Number(process.env.PORT || 4173);

const sourceCatalog = {
  official: [
    { name: "OpenAI News", url: "https://openai.com/news/" },
    { name: "Google AI Blog", url: "https://blog.google/technology/ai/" },
    { name: "Microsoft AI Blog", url: "https://blogs.microsoft.com/ai/" },
    { name: "Anthropic News", url: "https://www.anthropic.com/news" }
  ],
  news: [
    { name: "Google News", url: "https://news.google.com/search?q={query}&hl=ja&gl=JP&ceid=JP:ja" }
  ],
  social: [
    { name: "X Search", url: "https://x.com/search?q={query}&src=typed_query&f=live" }
  ]
};

const qualityPriorities = [
  "専門性・一次情報重視",
  "最新ニュース重視",
  "実務で使えるノウハウ重視",
  "SEO重視"
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        sourceCatalog,
        qualityPriorities,
        aiEnabled: Boolean(process.env.OPENAI_API_KEY),
        model: process.env.OPENAI_MODEL || "未設定"
      });
    }

    if (req.method === "POST" && url.pathname === "/api/ideas") {
      const body = await readJson(req);
      const ideas = await collectIdeas(body);
      return sendJson(res, { ideas });
    }

    if (req.method === "POST" && url.pathname === "/api/draft") {
      const body = await readJson(req);
      const draft = await createDraft(body);
      return sendJson(res, draft);
    }

    if (req.method === "POST" && url.pathname === "/api/save") {
      const body = await readJson(req);
      const saved = await saveMarkdown(body);
      return sendJson(res, saved);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendText(res, 405, "Method not allowed");
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "Unexpected error" }, 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Editpress is running at http://localhost:${port}`);
});

async function collectIdeas({ genre, keywords = "", include = {} }) {
  const query = [genre, keywords].filter(Boolean).join(" ");
  const ideas = [];

  if (include.official !== false) {
    for (const source of sourceCatalog.official) {
      ideas.push({
        id: crypto.randomUUID(),
        title: `${source.name}から「${query || genre}」の一次情報を確認する`,
        angle: "公式発表を起点に、変更点・実務影響・使いどころを解説する。",
        sourceType: "official",
        sourceName: source.name,
        url: source.url,
        score: 92
      });
    }
  }

  if (include.news !== false && query) {
    const newsItems = await fetchGoogleNewsRss(query).catch(() => []);
    for (const item of newsItems.slice(0, 8)) {
      ideas.push({
        id: crypto.randomUUID(),
        title: item.title,
        angle: "ニュースの背景と、読者が今取るべき実務上の判断を整理する。",
        sourceType: "news",
        sourceName: item.source || "Google News",
        url: item.link,
        publishedAt: item.pubDate,
        score: 84
      });
    }
  }

  if (include.social !== false && query) {
    ideas.push({
      id: crypto.randomUUID(),
      title: `Xで「${query}」の直近反応を確認する`,
      angle: "SNS上の疑問・反応・誤解を拾い、解説記事の切り口にする。",
      sourceType: "social",
      sourceName: "X Search",
      url: formatUrl(sourceCatalog.social[0].url, query),
      score: 72
    });
  }

  if (keywords.trim()) {
    ideas.push({
      id: crypto.randomUUID(),
      title: `「${keywords.trim()}」を実務者向けに体系化する`,
      angle: "入力キーワードを軸に、初心者向けではなく現場で使える判断基準まで掘る。",
      sourceType: "keyword",
      sourceName: "手入力キーワード",
      url: "",
      score: 78
    });
  }

  return ideas.sort((a, b) => b.score - a.score);
}

async function fetchGoogleNewsRss(query) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(rssUrl, {
      headers: { "User-Agent": "Editpress/0.1 (+local article planning tool)" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`News fetch failed: ${response.status}`);
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => {
      const item = match[1];
      return {
        title: decodeXml(readTag(item, "title")),
        link: decodeXml(readTag(item, "link")),
        pubDate: decodeXml(readTag(item, "pubDate")),
        source: decodeXml(readTag(item, "source"))
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

async function createDraft({ genre, keywords, idea, notes = "" }) {
  const prompt = buildPrompt({ genre, keywords, idea, notes });
  if (process.env.OPENAI_API_KEY) {
    const markdown = await generateWithOpenAI(prompt);
    return { markdown, aiGenerated: true };
  }
  return { markdown: buildTemplateDraft({ genre, keywords, idea, notes }), aiGenerated: false };
}

function buildPrompt({ genre, keywords, idea, notes }) {
  return [
    "あなたは日本語の編集者です。",
    "専門性・一次情報、最新性、実務ノウハウ、SEOの順で品質を重視してください。",
    "事実と推測を混ぜず、未確認情報は未確認と明示してください。",
    "Markdownで本文まで作成してください。メタディスクリプションと画像案は作成しないでください。",
    "",
    `ジャンル: ${genre}`,
    `キーワード: ${keywords || "未指定"}`,
    `採用ネタ: ${idea?.title || "未指定"}`,
    `切り口: ${idea?.angle || "未指定"}`,
    `参照元: ${idea?.url || "未指定"}`,
    `追加メモ: ${notes || "なし"}`
  ].join("\n");
}

async function generateWithOpenAI(prompt) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.4
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }
  const data = await response.json();
  return data.output_text || data.output?.flatMap((part) => part.content || []).map((part) => part.text || "").join("\n") || "";
}

function buildTemplateDraft({ genre, keywords, idea, notes }) {
  const title = idea?.title?.replace(/\s+-\s+[^-]+$/, "") || `${genre}の最新動向`;
  return `# ${title}

## 要点

- 対象ジャンル: ${genre}
- 主要キーワード: ${keywords || "未指定"}
- 参照元: ${idea?.url || "手入力"}
- 優先方針: ${qualityPriorities.join("、")}

## 背景

ここでは、一次情報やニュースを確認したうえで、読者が理解すべき背景を整理します。未確認の情報は断定せず、確認できた事実と今後の見通しを分けて扱います。

## 何が変わったのか

${idea?.angle || "選択したネタの変化点を、実務上の影響が分かる粒度で説明します。"}

## 実務での使いどころ

読者がすぐに判断できるように、導入すべき場面、まだ様子を見るべき場面、確認すべきリスクを整理します。

## 注意点

- 公式情報と二次情報の差を確認する
- SNS上の反応は事実確認の材料ではなく、読者ニーズの把握に使う
- 法務、個人情報、著作権、セキュリティに関わる内容は追加確認する

## まとめ

${genre}の記事では、話題性だけでなく、一次情報に基づく確認と実務への落とし込みが重要です。

${notes ? `\n## 編集メモ\n\n${notes}\n` : ""}`;
}

async function saveMarkdown({ markdown, title }) {
  if (!markdown?.trim()) throw new Error("Markdown is empty");
  await mkdir(articlesDir, { recursive: true });
  const filename = `${new Date().toISOString().slice(0, 10)}-${slugify(title || firstHeading(markdown) || "article")}.md`;
  const path = join(articlesDir, filename);
  await writeFile(path, markdown, "utf8");
  return { path: `articles/${filename}` };
}

async function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return sendText(res, 403, "Forbidden");
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function formatUrl(template, query) {
  return template.replace("{query}", encodeURIComponent(query));
}

function readTag(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "";
}

function decodeXml(value) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function firstHeading(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1];
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "article";
}
