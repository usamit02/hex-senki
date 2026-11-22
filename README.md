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
| `public/map1.json` | マップ(`hexes`: マスごとの地形・地図上の位置、および城と村・初期配置・初期資金)。読み込むファイル名は `src/data.ts` の `MAP_FILE` で決まります |
| `src/types.ts` | 型定義 |
| `src/hex.ts` | キューブ座標(x, y, z)の計算(距離・隣接・ピクセル変換) |
| `src/terrain.ts` | 地形ごとのルール(移動コスト・防御・色) |
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

駒のID(`units.json` のキー、マップJSONの `type`)は、**「系統_名前」** を小文字の英数字とアンダースコアで書きます。規則に合わないIDは、起動時にエラーとなります。

| 系統(先頭) | 意味 | 例 |
| --- | --- | --- |
| `infantry` | 歩兵 | `infantry_swordsman`, `infantry_spearman` |
| `ranged` | 弓・魔法などの遠距離 | `ranged_archer`, `ranged_mage` |
| `cavalry` | 騎兵 | `cavalry_knight` |
| `siege` | 攻城 | `siege_catapult` |

- 名前の部分は、さらに `_` で区切ってよい(例: `cavalry_heavy_knight`)。
- 表示名は、別の項目 `name`(日本語)で指定します。IDは画面に出ません。
- IDを変更するときは、`units.json` とマップJSONの両方を同じ名前に揃えてください。

## 地形

マップJSONの `hexes[].terrain` には、次の地形を指定できます(ルールは `src/terrain.ts`)。未対応の地形名があると、起動時にエラーとなります。

| terrain | 名前 | 移動コスト | 防御 |
| --- | --- | --- | --- |
| `plain` | 平地 | 1 | 0 |
| `forest` | 森 | 2 | +1 |
| `mountain` | 山 | 3 | +2 |
| `water` | 水 | 通れない | 0 |

城と村のマスは、地形に関わらず平地として扱います。

## 座標系

ゲーム内の計算はすべてキューブ座標 `(x, y, z)`(常に `x + y + z = 0`)で行います。マップJSONの `col` / `row` は、平らな辺が上のヘックス(フラットトップ)で奇数列が半マス下にずれる配置で、読み込み時にキューブ座標へ変換されます(`fromOffset`)。この配置は、`center_x` / `center_y`(地図上の位置)と照らし合わせて確認済みです。距離・隣接マスなどの共通処理は `src/hex.ts` にあります。

## 公開

`main` ブランチに push すると、GitHub Actions がビルドして GitHub Pages に公開します(Settings → Pages の Source を「GitHub Actions」にしてください)。
