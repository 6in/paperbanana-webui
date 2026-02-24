# 🍌 PaperBanana Web UI

PaperBanana Web UI は、学術図形をプロンプトから自動生成する強力なPythonライブラリ [PaperBanana](https://github.com/llmsresearch/paperbanana) を、直感的でモダンなブラウザ画面から操作できるようにしたプロジェクトです。

## ✨ 特徴とコンセプト

本プロジェクトは以下の3つのコンセプトを軸に開発されました。

1. **🎨 GlassmorphismによるプレミアムなUX**
   * Tailwind CSSを活用し、論文執筆のモチベーションが上がるような、すりガラス調で美しい「チャット＆プレビュー」の2画面インターフェースを提供します。
2. **🚀 待たせない「同時並列生成（Parallel Generation）」**
   * Pythonの非同期処理（`asyncio.gather`）をバックエンドのAPIに組み込みました。ユーザーが複数の図案を見比べたいとき、裏側で複数のAIエージェントが**同時に並行して作画を開始**します。これにより、待ち時間は1案分（数十秒）のまま、バリエーション豊かな図形が一気に生成されます。
3. **📦 クリーンなアーキテクチャ（Git Submodule）**
   * 本プロジェクト（Web UI）は、公式のPaperBanana生成エンジンを「Gitサブモジュール」として参照する形で完全に分離させています。これにより、本家ソースコードを汚すことなく安全にUIを開発でき、本家のアップデートにもコマンド一発で簡単に追従できます。

> 📖 **開発ストーリーを読む**
> なぜ「Image-to-Image（やり直し）」をやめてこの並列アーキテクチャに行き着いたのか？ 詳細はブログ記事 [`docs/blogs/paperbanana-webui-story.md`](./docs/blogs/paperbanana-webui-story.md) をご覧ください！

---

## 🛠️ セットアップと起動方法

本プロジェクトは、React（Vite）のフロントエンドと、FastAPI（Python）のバックエンドで構成されています。
バックエンドは公式のPaperBananaをサブモジュールとして読み込んで動作します。

### 1. リポジトリのクローン
本プロジェクトには公式エンジン（PaperBanana）がサブモジュールとして含まれています。必ず `--recursive` フラグをつけてクローンしてください。

```bash
git clone --recursive <本リポジトリのURL>
cd paper-banana
```

> **注意**: もし普通にクローンしてしまった場合は、`git submodule update --init --recursive` を実行してPaperBananaのコードを取得してください。

### 2. 環境変数の設定
プロジェクトルート直下（または `webui/` 直下）に `.env` ファイルを作成し、必要なAPIキーを設定します。

```env
# .env の例
GOOGLE_API_KEY="your-gemini-api-key-here"
OPENAI_API_KEY="your-openai-api-key-here" # (任意)
```

### 3. バックエンドの起動 (FastAPI)

Python 3.10以上が必要です。

```bash
# 1. バックエンドディレクトリへ移動
cd webui/backend

# 2. 仮想環境の作成と有効化
python3 -m venv venv
source venv/bin/activate  # (Windowsの場合は `venv\Scripts\activate`)

# 3. 依存ライブラリのインストール
# (公式PaperBananaエンジンを開発モードでインストール + FastAPI/WebSocket)
pip install -e ../../paperbanana/paperbanana
pip install fastapi uvicorn websockets python-dotenv

# 4. サーバーの起動 (ポート 54311)
uvicorn main:app --reload --host 127.0.0.1 --port 54311
```
> バックエンドが `ws://localhost:54311/api/ws/generate` で待機状態になります。

### 4. フロントエンドの起動 (React/Vite)

Node.js（v18以上）が必要です。

```bash
# 1. フロントエンドディレクトリへ移動（新しいターミナルタブで）
cd webui/frontend

# 2. パッケージのインストール
npm install

# 3. 開発サーバーの起動
npm run dev
```

> 起動後、ターミナルに表示されるローカルURL（例: `http://localhost:54312`）にブラウザでアクセスしてください！

---
Enjoy effortless academic diagramming with **PaperBanana**! 🍌✨
