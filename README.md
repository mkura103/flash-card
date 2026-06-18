# 単語帳アプリ (Flash Card)

GitHub Pages で動く、ビルド不要の単語帳アプリです。素の HTML / CSS / JavaScript のみで構成されています。

初期データとして、日常会話で使う頻出英単語 979 語（テーマ別 18 カテゴリ・難易度★1〜3付き）を収録しています。

## 機能

- カードめくり（表 / 裏） … カードをタップ、または `Space` / `Enter`
- シャッフル出題 / 登録順 / 習熟度優先（苦手から）出題
- カテゴリ・難易度（★1〜3）による絞り込み
- 苦手のみ出題
- 習熟度管理（SRS 風）… 「覚えた」でレベル＋1、「まだ」でレベル−1
- 進捗バー・正答率・習得語数の表示
- 学習状態は `localStorage` に保存（サーバ不要）

### キーボード操作

| キー | 動作 |
|------|------|
| `Space` / `Enter` | カードをめくる |
| `→` | 覚えた |
| `←` | まだ |

## 単語データの編集

`data/words.json` を編集してください。

```json
{
  "meta": { "title": "タイトル", "description": "説明" },
  "cards": [
    { "id": "w001", "front": "apple", "back": "りんご", "category": "果物", "difficulty": 1, "hint": "赤い果物" }
  ]
}
```

- `id` … カードの一意な識別子（学習記録の保存キー。重複・変更しないこと）
- `front` … 表（問題）
- `back` … 裏（答え）
- `category` … グルーピング用（任意）
- `difficulty` … 難易度。`1`=易しい / `2`=ふつう / `3`=難しい（任意。絞り込みとカード上の★表示に使用）
- `hint` … 表に表示するヒント（任意）

## ローカルで動かす

`fetch` を使うため、ファイルを直接開くのではなく簡易サーバ経由で開いてください。

```bash
python3 -m http.server 8000
# http://localhost:8000 を開く
```

## GitHub Pages への公開

1. このディレクトリを GitHub リポジトリに push
2. リポジトリの Settings → Pages → Build and deployment
3. Source を「Deploy from a branch」、Branch を `main` / `(root)` に設定
4. 数分後 `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開
