# Editpress

記事ジャンルとキーワードを指定し、公式ブログ・ニュース検索・X検索・手入力キーワードから記事ネタ候補を作るローカルWebアプリです。選んだ候補から本文Markdownを作成し、`articles/` に保存できます。

## 現在の仕様

- ジャンルは毎回選択: AI活用、生成AI、アプリ、専門業界向け記事、ニュース解説。
- 情報源: 公式ブログ、Google News RSS、X検索リンク、手入力キーワード。
- 品質方針: 専門性・一次情報、最新ニュース、実務ノウハウ、SEOの順で重視。
- 出力: 画面プレビューとMarkdown保存。
- メタディスクリプションと画像案は、本文査閲後に別工程で作る想定。

## 起動方法

```powershell
node server.js
```

ブラウザで次を開きます。

```text
http://localhost:4173
```

iPhoneから使う場合は、PCとiPhoneを同じWi-Fiに接続し、PCのローカルIPアドレスで開きます。

```text
http://<PCのローカルIP>:4173
```

## AI本文生成

`OPENAI_API_KEY` を設定すると、本文生成にOpenAI APIを使います。未設定の場合は、確認用のMarkdownテンプレートを作成します。

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-4.1-mini"
node server.js
```

## 構文チェック

```powershell
node --check server.js
node --check public/app.js
```
