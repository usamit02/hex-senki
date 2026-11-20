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
| `src/hex.ts` | ヘックス座標の計算(距離・ピクセル変換) |
| `src/data.ts` | JSON の読み込み |
| `src/state.ts` | ゲーム状態の作成と参照(収入・首都など) |
| `src/rules.ts` | 移動・攻撃・雇用・勝敗判定のルール |
| `src/ai.ts` | 敵CPUの思考 |
| `src/turn.ts` | ターンの進行 |
| `src/render.ts` | canvas への描画 |
| `src/input.ts` | 盤面のクリック操作 |
| `src/ui.ts` | ボタンや資金表示 |
| `src/main.ts` | 起動と全体の組み立て |

駒の種類は `units.json` に追加すると、雇用ボタンも自動で増えます。

## 公開

`main` ブランチに push すると、GitHub Actions がビルドして GitHub Pages に公開します(Settings → Pages の Source を「GitHub Actions」にしてください)。
