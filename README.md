# ヘックス戦記

ブラウザで遊べる、ヘックスマップのターン制ストラテジーゲームです。TypeScript + Vite + Phaser で作っています。

## 開発

```
npm install
npm run dev        # 開発サーバー
npm run build      # 型チェック + dist/ にビルド
```

## 今回のアップグレード(要件1〜7)

| # | 要件 | 実装 |
| --- | --- | --- |
| 1 | マップ100×100、陣営2、各陣営100部隊まで | `src/types.ts` の `MAX_MAP_COLS/ROWS=100`、`MAX_UNITS_PER_SIDE=100`。読み込み時に上限チェックし、雇用・初期配置も上限で止める |
| 2 | 描画を Phaser 化、拡大/縮小・スクロール | `src/render.ts` を Phaser 3 の Scene に置換。ホイール=ポインタ中心ズーム、ドラッグ=スクロール、矢印キー/WASDでも移動 |
| 3 | マップ全面表示、コマンド/情報は右クリックメニューと隠れるペイン | `index.html` / `src/style.css` / `src/ui.ts`。常時表示はターン・資金チップのみ。左=情報、右=雇用、下=ログ・コマンドのペインが画面端タブで開閉 |
| 4 | hex.json を読んで描画、道路・河川を編集アプリと同じ繋ぎ方 | 中心→辺の中点→中心の折れ線(編集アプリ `path_render_points` と同一)。河川は水・沼ヘックス内、道路・河川は都市ヘックス内に描かない(隣接は辺の中点まで)ルールも編集アプリに合わせた。国道は赤・太め、その他道路は黄、河川は青 |
| 5 | 都市は hex.json の towns からアイコン表示、右クリックで情報 | ヘックス中央にビルアイコン+都市名(拡大時のみ名前表示)。右クリックメニューと左ペインに人口・コード等を表示 |
| 6 | 初期配置は map.json | `src/data.ts` が map.json(初期配置・資金)と hex.json(地形・道路・河川・都市)を分けて読み込む |
| 7 | AI は Comlink + Web Workers の Worker Pool 化(入れ物のみ) | `src/ai/protocol.ts`(通信型)、`src/ai/worker.ts`(Worker入口・スタブ)、`src/ai/pool.ts`(コア数-1で Pool、ラウンドロビン)。思考本体は従来の `src/ai.ts` 簡易AIのまま未接続 |

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `public/units.json` | 駒の能力値(HP・移動・攻撃・射程・コスト) |
| `public/map.json` | 初期配置・初期資金(任意で cities: 城/村と首都) |
| `public/hex.json` | マップ本体(`hexes` / `roads` / `rivers` / `towns`)。編集アプリで保存した hex.json をそのまま置ける |
| `src/types.ts` | 型定義と上限値 |
| `src/hex.ts` | キューブ座標(x, y, z)の計算 |
| `src/terrain.ts` | 地形ごとのルール(移動コスト・防御・色) |
| `src/data.ts` | JSON の読み込み |
| `src/validate.ts` | units.json のチェック |
| `src/state.ts` | ゲーム状態の作成と参照(道路・河川・都市の取り込み含む) |
| `src/rules.ts` | 移動・攻撃・雇用・勝敗判定のルール |
| `src/ai.ts` | 敵CPUの思考(現行の簡易版) |
| `src/ai/` | 将来の Worker 版AI(protocol / worker / pool) |
| `src/turn.ts` | ターンの進行 |
| `src/render.ts` | Phaser による描画・カメラ操作 |
| `src/input.ts` | クリック操作のルール処理と右クリック情報の生成 |
| `src/ui.ts` | 右クリックメニューと隠れるペイン、最小限のHUD |
| `src/main.ts` | 起動と全体の組み立て |

## 注意(同梱データについて)

- 同梱の `map.json` には `cities` が無いため、城・雇用・首都による勝敗は無効で、勝敗は部隊の全滅で決まります。城を使いたい場合は map.json に `cities` を追加してください(旧形式と互換)。
- 同梱の `map.json` の初期配置(col 1〜7, row 2〜4)は、同梱の hex.json(道央マップ)では全て水ヘックスの上になります。水の上では移動できません。配置先を陸地の col/row に直してください。

## 駒の種類とIDの命名規則

駒の種類は `units.json` に追加すると、雇用ボタンも自動で増えます。

駒のID(`units.json` のキー、マップJSONの `type`)は、**「系統_名前」** を小文字の英数字とアンダースコアで書きます。規則に合わないIDは、起動時にエラーとなります。

| 系統(先頭) | 意味 | 例 |
| --- | --- | --- |
| `infantry` | 歩兵 | `infantry_swordsman`, `infantry_spearman` |
| `ranged` | 弓・魔法などの遠距離 | `ranged_archer`, `ranged_mage` |
| `cavalry` | 騎兵 | `cavalry_knight` |
| `siege` | 攻城 | `siege_catapult` |

## 地形

| terrain | 名前 | 移動コスト | 防御 |
| --- | --- | --- | --- |
| `plain` | 平地 | 1 | 0 |
| `forest` | 森 | 2 | +1 |
| `mountain` | 山 | 3 | +2 |
| `water` | 水 | 通れない | 0 |
| `marsh` | 沼 | 3 | 0 |

## 公開

`main` ブランチに push すると、GitHub Actions がビルドして GitHub Pages に公開します(Settings → Pages の Source を「GitHub Actions」にしてください)。
