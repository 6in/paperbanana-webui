# 引継書: PaperBanana Web UI プロジェクトの構築

このドキュメントは、オープンソースの学術図自動生成ツール「[PaperBanana](https://github.com/llmsresearch/paperbanana)」向けの Web UI を新しく構築する、次のAIエージェントへの引継ぎ資料です。

## プロジェクトの背景と目的
ユーザーは現在、CLIベースの `paperbanana` を利用していますが、直感的に操作でき、かつAIエージェントの処理の進捗をリアルタイムで確認できるようなモダンな Web UI を求めています。

ただし、**重要な制約事項**があります：
> `paperbanana` の本体リポジトリは非常に高い頻度で更新（`git pull`）されるため、**Web UI のソースコードを本体リポジトリ内に直接置くと、マージコンフリクトや管理の煩雑化を招く**という問題があります。

## 決定済みの構成案（Option 1: 完全分離アーキテクチャ）
この問題を回避するため、Web UI プロジェクトは**本体ディレクトリとは完全に別の専用ディレクトリ**に構築します（例: `paperbanana-webui`）。

### ディレクトリ構造イメージ
```text
(User's Machine)
├── workspaces/rd/paper-banana/      <-- 新規作成の親ディレクトリ
│   ├── paper-banana/                <-- 頻繁に更新される本体リポジトリ (Git clone)
│   └── web-ui/                      <-- 新規作成するWeb UIプロジェクト
│       ├── backend/ (FastAPI)       <-- Pythonサーバー
│       └── frontend/ (React/Vite)   <-- モダンなWebフロントエンド
```

### バックエンド (FastAPI) の要件
- `paper-banana` 本体をローカルの編集可能モードでインストールして利用します。
  例: `pip install -e /Users/ohya/workspaces/rd/paper-banana/paper-banana`
- `paperbanana.core.pipeline.PaperBananaPipeline` をインポートし、Web APIとしてラップします。
- **WebSocket 通信**を実装し、生成の途中経過（Phase 0の最適化、Phase 1のプランニング、Phase 2の画像生成イテレーションなど）をフロントエンドへリアルタイムにストリーミング（配信）できるようにします。

### フロントエンド (React/Vite) の要件
- Tailwind CSS (v4) などを用いた、モダンで洗練されたGlassmorphismなデザイン（Wowを意識したUI）を作成してください。
- 左側にテキストプロンプトや設定項目（VLMの種類やイテレーション回数）、右側にリアルタイムな進捗ログと生成画像が表示されるような画面構成を想定しています。

## 次のAIが最初にやるべきこと（Next Steps）
1. ユーザーに対して、**実際の `paperbanana-webui` ディレクトリの作成場所**（同じ `workspaces/rd/` 直下でよいか等）を確認してください。
2. ディレクトリ作成場所の合意が取れたら、上記の「完全分離アーキテクチャ」に基づいて、`backend/`（FastAPI）と `frontend/`（Vite TypeScript + Tailwind）の空プロジェクトのスカッフォルド（雛形作成）を実行してください。
3. 自動で構築を進める場合は、**必ずユーザーに確認を取りながら**（自動承認を無効化する設定や、勝手にコマンドを全実行しないよう注意しながら）進めてください。

---
以上が、本日の検討を通して決定した「最も実現可能で、保守性の高い構成案」の引継ぎ事項です。よろしくお願いいたします。
