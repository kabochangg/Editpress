const state = {
  ideas: [],
  selectedIdea: null,
  markdown: ""
};

const els = {
  apiStatus: document.querySelector("#apiStatus"),
  genre: document.querySelector("#genre"),
  keywords: document.querySelector("#keywords"),
  official: document.querySelector("#official"),
  news: document.querySelector("#news"),
  social: document.querySelector("#social"),
  notes: document.querySelector("#notes"),
  collectButton: document.querySelector("#collectButton"),
  draftButton: document.querySelector("#draftButton"),
  saveButton: document.querySelector("#saveButton"),
  ideas: document.querySelector("#ideas"),
  ideaCount: document.querySelector("#ideaCount"),
  preview: document.querySelector("#preview"),
  draftState: document.querySelector("#draftState"),
  toast: document.querySelector("#toast")
};

init();

async function init() {
  els.collectButton.addEventListener("click", collectIdeas);
  els.draftButton.addEventListener("click", createDraft);
  els.saveButton.addEventListener("click", saveMarkdown);
  const config = await api("/api/config");
  els.apiStatus.textContent = config.aiEnabled ? `AI有効 ${config.model}` : "AI未設定";
}

async function collectIdeas() {
  setBusy(els.collectButton, true, "収集中");
  try {
    const data = await api("/api/ideas", {
      genre: els.genre.value,
      keywords: els.keywords.value,
      include: {
        official: els.official.checked,
        news: els.news.checked,
        social: els.social.checked
      }
    });
    state.ideas = data.ideas;
    state.selectedIdea = null;
    state.markdown = "";
    renderIdeas();
    renderPreview("");
    els.draftButton.disabled = true;
    els.saveButton.disabled = true;
    showToast(`${state.ideas.length}件の候補を取得しました`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(els.collectButton, false);
  }
}

async function createDraft() {
  if (!state.selectedIdea) return;
  setBusy(els.draftButton, true, "作成中");
  try {
    const data = await api("/api/draft", {
      genre: els.genre.value,
      keywords: els.keywords.value,
      idea: state.selectedIdea,
      notes: els.notes.value
    });
    state.markdown = data.markdown;
    renderPreview(state.markdown);
    els.saveButton.disabled = false;
    els.draftState.textContent = data.aiGenerated ? "AI生成済み" : "テンプレート作成";
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(els.draftButton, false);
  }
}

async function saveMarkdown() {
  setBusy(els.saveButton, true, "保存中");
  try {
    const data = await api("/api/save", {
      title: state.selectedIdea?.title,
      markdown: state.markdown
    });
    showToast(`保存しました: ${data.path}`);
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(els.saveButton, false);
  }
}

function renderIdeas() {
  els.ideaCount.textContent = `${state.ideas.length}件`;
  if (!state.ideas.length) {
    els.ideas.className = "ideas empty";
    els.ideas.textContent = "候補がありません。キーワードや情報源を変えてください。";
    return;
  }

  els.ideas.className = "ideas";
  els.ideas.replaceChildren(
    ...state.ideas.map((idea) => {
      const button = document.createElement("button");
      button.className = `idea${state.selectedIdea?.id === idea.id ? " selected" : ""}`;
      button.type = "button";
      button.addEventListener("click", () => {
        state.selectedIdea = idea;
        els.draftButton.disabled = false;
        renderIdeas();
      });

      const title = document.createElement("div");
      title.className = "idea-title";
      title.textContent = idea.title;

      const angle = document.createElement("div");
      angle.textContent = idea.angle;

      const meta = document.createElement("div");
      meta.className = "idea-meta";
      meta.append(tag(idea.sourceType), tag(idea.sourceName), tag(`score ${idea.score}`));

      button.append(title, angle, meta);
      if (idea.url) {
        const link = document.createElement("a");
        link.href = idea.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = idea.url;
        link.addEventListener("click", (event) => event.stopPropagation());
        button.append(link);
      }
      return button;
    })
  );
}

function renderPreview(markdown) {
  if (!markdown) {
    els.preview.className = "preview empty";
    els.preview.textContent = "本文生成後にMarkdownプレビューを表示します。";
    els.draftState.textContent = "未作成";
    return;
  }
  els.preview.className = "preview";
  els.preview.innerHTML = markdownToHtml(markdown);
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  let html = "";
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (inList) html += "</ul>";
      inList = false;
      html += `<h1>${escapeHtml(line.slice(2))}</h1>`;
    } else if (line.startsWith("## ")) {
      if (inList) html += "</ul>";
      inList = false;
      html += `<h2>${escapeHtml(line.slice(3))}</h2>`;
    } else if (line.startsWith("- ")) {
      if (!inList) html += "<ul>";
      inList = true;
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
    } else if (line.trim()) {
      if (inList) html += "</ul>";
      inList = false;
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  if (inList) html += "</ul>";
  return html;
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function tag(text) {
  const span = document.createElement("span");
  span.className = "tag";
  span.textContent = text;
  return span;
}

function setBusy(button, busy, text) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label;
    button.disabled = false;
    if (button === els.draftButton && !state.selectedIdea) button.disabled = true;
    if (button === els.saveButton && !state.markdown) button.disabled = true;
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
