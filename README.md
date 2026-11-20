# ヘックス戦記

ブラウザで遊べる、ヘックスマップのターン制ストラテジーゲームです。TypeScript + Vite で作っています。

## 開発

```
npm install
npm run dev        # 開発サーバー
npm run build      # 型チェック + dist/ にビルド
```

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `public/units.json` | 駒の能力値(HP・移動・攻撃・射程・コスト) |
| `public/map.json` | マップ(地形・城と村・初期配置・初期資金) |
| `src/types.ts` | 型定義 |
| `src/hex.ts` | キューブ座標(x, y, z)の計算(距離・隣接・ピクセル変換) |
| `src/data.ts` | JSON の読み込み |
| `src/validate.ts` | units.json のチェック(IDの命名規則・必須項目) |
| `src/state.ts` | ゲーム状態の作成と参照(収入・首都など) |
| `src/rules.ts` | 移動・攻撃・雇用・勝敗判定のルール |
| `src/ai.ts` | 敵CPUの思考 |
| `src/turn.ts` | ターンの進行 |
| `src/render.ts` | canvas への描画 |
| `src/input.ts` | 盤面のクリック操作 |
| `src/ui.ts` | ボタンや資金表示 |
| `src/main.ts` | 起動と全体の組み立て |

## 駒の種類とIDの命名規則

駒の種類は `units.json` に追加すると、雇用ボタンも自動で増えます。

駒のID(`units.json` のキー、`map.json` の `type`)は、**「系統_名前」** を小文字の英数字とアンダースコアで書きます。規則に合わないIDは、起動時にエラーとなります。

| 系統(先頭) | 意味 | 例 |
| --- | --- | --- |
| `infantry` | 歩兵 | `infantry_swordsman`, `infantry_spearman` |
| `ranged` | 弓・魔法などの遠距離 | `ranged_archer`, `ranged_mage` |
| `cavalry` | 騎兵 | `cavalry_knight` |
| `siege` | 攻城 | `siege_catapult` |

- 名前の部分は、さらに `_` で区切ってよい(例: `cavalry_heavy_knight`)。
- 表示名は、別の項目 `name`(日本語)で指定します。IDは画面に出ません。
- IDを変更するときは、`units.json` と `map.json` の両方を同じ名前に揃えてください。

## 座標系

ゲーム内の計算はすべてキューブ座標 `(x, y, z)`(常に `x + y + z = 0`)で行います。`map.json` の `col` / `row` は、奇数行が半マス右にずれる配置で、読み込み時にキューブ座標へ変換されます(`fromOffset`)。距離・隣接マスなどの共通処理は `src/hex.ts` にあります。

## 公開

`main` ブランチに push すると、GitHub Actions がビルドして GitHub Pages に公開します(Settings → Pages の Source を「GitHub Actions」にしてください)。
