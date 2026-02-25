# 🍌 学術図形をもっと手軽に！「PaperBanana」Web UI開発ストーリー ✨

みなさん、こんにちは！👋
論文やプレゼン資料を作るとき、「概念図（Methodology Diagram）」や「フローチャート」を作るのって、時間がかかって大変ですよね…？😢

そんな悩みを解決するのが、テキストベースのプロンプトから学術的な図形を自動生成してくれるツール **「PaperBanana」** です！🍌✨

これまではコマンドライン上で動くちょっと玄人向けのツールだったのですが、もっと色んな人に気軽に使ってもらいたい！ということで、今回 **「PaperBananaのモダンなWeb UI」** を開発しちゃいました！🎉💻

今回は、その開発の裏側と、私たちがぶつかった困難、そしてどうやってそれを乗り越えたのかを、ストーリー仕立てでお届けします！📖✨

---

## 🧭 PaperBananaの処理フロー（まずここだけ見ればOK）

```mermaid
flowchart TD
    A[ユーザー入力<br/>source_context + intent] --> B{入力最適化を有効化?}
    B -- Yes --> B1[Context Enricher]
    B -- Yes --> B2[Caption Sharpener]
    B1 --> C[統合プロンプト]
    B2 --> C
    B -- No --> C

    C --> D[Retriever<br/>参考図を検索]
    D --> E[Planner<br/>図の詳細説明を生成]
    E --> F[Stylist<br/>見た目を整形]

    F --> G[Visualizer<br/>画像生成]
    G --> H[Critic<br/>品質評価]
    H --> I{修正が必要?}
    I -- Yes --> F
    I -- No --> J[final_output.png]

    J --> K[メタデータ保存<br/>run_id / tokens / cost / logs]
```

> このループ（Visualizer ↔ Critic）を回すことで、図の品質を段階的に改善します。

---

## 🎨 コンセプト：直感的で「Wow!」な体験を

今回のWeb UI開発のコンセプトは、ズバリ **「Glassmorphism（グラスモーフィズム）」** と **「モダンでプレミアムな体験」** です！✨

* **左ペイン：チャットインターフェース** 💬
  AIエージェントと対話しながら、どんな図を作りたいかプロンプトを入力します。「〇〇の図を作って！」とお願いするだけ！
* **右ペイン：リアルタイムプレビュー＆結果表示** 🖼️
  AIが考えている途中のログ（Phase 0: 情報検索 🔍 → Phase 1: 設計図作成 📝 → Phase 2: 作画 🎨）がリアルタイムで流れ、最終的な美しい図がどーん！と表示されます。

すりガラスのような半透明のUI（Tailwind CSSを活用）で、使っていて気持ちの良い、未来感のあるデザインを目指しました！✨

> 📸 **ここに挿絵を挿入！**
> *コメント：開発したWeb UIの全体画面のキャプチャ（チャット欄とプレビュー画面がわかる綺麗なスクリーンショット）を貼ると効果的です！*

```mermaid
flowchart LR
    User[ユーザー] --> UI[Web UI<br/>React + Vite]
    UI -->|WebSocket /api/ws/generate| API[Web API<br/>FastAPI]
    UI -->|HTTP /api/test-token| API

    subgraph PB[PaperBanana Core（本体）]
      direction TB
      P0[Input Optimizer]
      P1[Retriever / Planner / Stylist]
      P2[Visualizer / Critic Loop]
      P0 --> P1 --> P2
    end

    API -->|pipeline.generate()| PB
    PB -->|画像 / ログ / トークン使用量| API
    API -->|リアルタイム配信| UI
    UI -->|プレビュー / コスト表示| User
```
> この構造では、**PaperBanana本体は「生成エンジン」**、Web UIは「操作と可視化レイヤー」という役割分担です。


---

## 🚧 発生した困難と、見えてきた「AI生成」の壁

開発は順調にスタート！FastAPI（バックエンド）とReact/Vite（フロントエンド）を疎結合にし、WebSocketでリアルタイム通信するモダンな構成を採用しました🚀

しかし、UIが完成して実際に図を作ってみると、1つ大きな壁にぶつかりました…。

### 💥 困難1：イテレーション（やり直し）で画質が劣化する問題

「ここをもっとこうして！」という追加指示（イテレーション）に対応するため、最初の実装では**「1回目にできた画像をAIに再度読み込ませて、上書き修正させる」** というアプローチを試みました。

ところが…！😱
画像を何度も読み込んで上書きしていくと、**テキストが潰れて読めなくなったり、全体がぼやけたりして、どんどん画質が劣化してしまった** のです😭

> 📸 **ここに挿絵を挿入！**
> *コメント：画質が劣化してしまった失敗例のキャプチャ（文字が潰れているものなど）を貼ると、説得力が増します！*

### 💡 解決策：「設計図」から描き直す！

画質の劣化を防ぐにはどうすればいいか？
私たちが辿り着いた答えは、**「元の画像に手を加えるのではなく、AIが内部で持っている『テキストの設計図（プロンプト）』の方を修正し、毎回ゼロから高画質に描き直す（Text-to-Image）」** という、PaperBanana本来のストロングポイントに立ち返ることでした！✨

これにより、何度やり直しても、文字がクッキリ読める最高品質の図面をキープできるようになりました！🎊

---

## 🚀 さらなる進化へ：同時並列生成（Parallel Generation）の実現！

修正の方針は決まりましたが、ここでふと冷静になって考えてみました。「そもそも一発目の画質が一番綺麗で精度も高いなら、やり直すよりも、**最初から構図の違う何パターンかの図案を一気に出しちゃえばいいんじゃない？**」🤔

この気づきから、プロジェクトはさらなる進化を遂げます！✨

### 💥 困難2：どうやって待たせずに複数作るか？

AIに3パターンの図案を作ってもらうとして、「1案目が終わったら2案目…」と順番（直列）に処理していては、待ち時間が3倍になってしまいます💦

### 💡 解決策：非同期処理で「同時に」作らせる！

ここで、FastAPIとPythonの強力な武器 **`async / await`** と **`asyncio.gather`** の出番です！🔥

バックエンドのアーキテクチャを工夫し、「並列数：3」でリクエストが来たら、**裏側で3つの独立したAIエージェントを「完全に同時」に起動**するようにしました！🧠🧠🧠

```mermaid
sequenceDiagram
    participant UI as Web UI (React)
    participant FastAPI as Backend (main.py)
    participant P1 as Pipeline Instance 1
    participant P2 as Pipeline Instance 2
    participant P3 as Pipeline Instance 3

    UI->>FastAPI: Generate( prompt, parallel=3 )
    activate FastAPI
    
    note over FastAPI: asyncio.gather() で同時発火🔥
    
    FastAPI->>P1: pipeline.generate()
    FastAPI->>P2: pipeline.generate()
    FastAPI->>P3: pipeline.generate()
    
    activate P1
    activate P2
    activate P3
    
    P2-->>FastAPI: Image B Completed!
    deactivate P2
    FastAPI-->>UI: (WebSocket) Image B
    
    P1-->>FastAPI: Image A Completed!
    deactivate P1
    FastAPI-->>UI: (WebSocket) Image A
    
    P3-->>FastAPI: Image C Completed!
    deactivate P3
    FastAPI-->>UI: (WebSocket) Image C
    
    deactivate FastAPI
    note over UI: チャット画面に3枚の画像が<br/>Gridで次々に出現！🎉
```

これにより、待ち時間はほぼ1案分（数十秒）のまま、**全く異なるテイストの3つの図形が、チャット画面にポンッポンッと次々に現れる** という、最高にスマートなUXが完成しました！🎉✨

---

## 💸 料金表示処理の死闘：なぜずっと `$0.0000` だったのか？

実は、今回いちばん泥臭くて、でも学びが大きかったのが **「コスト表示の不具合」** でした。  
画面上ではずっと `$0.0000`。でも実際にはAPIは動いていて、トークンは消費している…。  
「これは表示の問題か？取得の問題か？集計の問題か？」を1つずつ潰していく戦いでした🔥

### 🧪 切り分け1：まず「疎通テストAPI」を作る

図を毎回生成するとコストが重いので、軽量な `/api/test-token` を追加。  
**PaperBanana VLM → structlog → Queue → token parse → cost calc** の本番と同じ経路を、最小コストで検証できるようにしました。

さらにフロントにも「API疎通」ボタンを追加し、結果をポップアップではなくログ欄に表示。  
これで「どこで値が落ちているか」をUI上で即確認できるようになりました。

### 🧩 根本原因は1つではなかった

調査すると、原因は複数が連鎖していました。

1. **表示桁数の罠**  
   実コストが `$0.000001` でも、表示が `.toFixed(4)` だと `$0.0000` に見える。

2. **ログの取り方の罠（structlog）**  
   文字列フォーマットの出し方だと、トークンがイベントとして正しく拾えないケースがあり、`TOKEN_USAGE` 抽出が不安定だった。

3. **Gemini usage_metadata の癖**  
   モデルによっては `candidates_token_count` が `None`。  
   `total_token_count - prompt_token_count` で補完が必要だった。

4. **イベントループのブロック**  
   `generate_content()` が同期呼び出しだと、WebSocketドレインが止まり、リアルタイム集計が進まない。

5. **ドレインの早期キャンセル**  
   finallyで即キャンセルしてしまい、キューに溜まっていたログ（=課金計算の材料）を捨てていた。

### ✅ 最終的な解決

* `TOKEN_USAGE` を安定して構造化ログに載せる
* トークン抽出のフォールバックを強化（Gemini特有の形も対応）
* `generate_content()` を `asyncio.to_thread()` 化してイベントループをブロックしない
* キューのドレイン完了を待ってから終了する
* 表示桁を6桁にして微小コストも可視化する

その結果、ついに画面に **`💸 $0.002754`** が表示！🎉  
ログにも `TOKEN_USAGE input_tokens=... output_tokens=...` がリアルタイムに流れ、  
「取れているのか分からない」状態から、**「いつ・どこで・いくら使ったかが見える」状態** に到達できました。

---

## 🏗️ こだわりのアーキテクチャ：Gitサブモジュールによる綺麗な分離

最後に、開発者向けのちょっとマニアックな工夫もご紹介します！🛠️

今回のWeb UIは、本家「PaperBanana」のソースコードに直接手を入れるのではなく、**「Gitサブモジュール」** として本家リポジトリを取り込む構成にしました！📦

```mermaid
graph TD
    subgraph Web UI Project ["Web UI Project (Your Repo)"]
        UI["/webui/frontend<br/>(React / Vite)"] 
        API["/webui/backend<br/>(FastAPI / WebSockets)"]
        
        subgraph Submodule ["Git Submodule"]
            Core["/paperbanana<br/>(Official Generator Engine)"]
        end
        
        UI --"WebSocket"--> API
        API --"import & async call"--> Core
    end
    
    style Submodule fill:#f1f5f9,stroke:#94a3b8,stroke-dasharray: 5 5
    style Core fill:#f8fafc,stroke:#cbd5e1
    style UI fill:#ecfdf5,stroke:#10b981
    style API fill:#eff6ff,stroke:#3b82f6
```

* **メリット1**：本家のクリーンなソースコードを一切汚さずにUI開発ができる！
* **メリット2**：本家にアップデートがあっても、コマンド一発で簡単に追従できる！

さらに運用面では、最終的に **PaperBanana本体をForkしたリポジトリを自分たちの`origin`として利用**する形にしました。  
これにより、Web UI側の改修に必要な本体パッチ（例：トークン計測や非同期化の修正）を安全に管理しつつ、必要なタイミングで本家の更新を取り込めるようになりました。

「UIはUI、コアエンジンはコアエンジン」と分離（Complete Separation Architecture）することで、安全で保守性の高いイケてるプロジェクト構成になりました😎✨

---

## 🎉 おわりに

いかがでしたでしょうか？✨
最新のAI機能とモダンなWeb技術を組み合わせることで、「論文の図表作り」という大変な作業が、もっとワクワクする楽しい体験になれば嬉しいです！😆

PaperBanana Web UI、ぜひぜひ使ってみてくださいね！🍌🚀

それでは、次回のアップデートをお楽しみに！👋✨
