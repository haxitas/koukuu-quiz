# MUSENN PHASE NOTES

## Phase0(完了 — 2026-07-21)

### 完了したこと
- 素のHTML+JS(フレームワーク無し・ビルド不要)の静的アプリを実装。
  - `index.html` / `app.js`(表示・遷移・採点結線) / `style.css`(ダークモード対応・モバイル最適化) / `quiz-core.mjs`(採点と成績の純粋関数)。
- 実データ1期 `data/R8-02.json`(既存 `sample_R8-02.json` を移設)を読み込み。
- 画面:選択(年・期→科目、各科目に前回/最高正答率・挑戦回数)→ 出題(1問ずつ・前へ/次へ)→ 採点 → 誤答のみ一覧(問題文・自分の解答・正解・解説)。
- 成績を localStorage(`aviation_quiz_results`)に **append で保存**。
- TDD:採点・append-only・統計の純粋関数を先にテスト化。
  - node が無い環境のため、同じ `quiz-core.mjs` を **ブラウザのテストランナー**(`tests/run-tests.html`)で実行。
  - スタブ実装で **FAIL 16/16(赤)** を確認 → 本実装で **PASS 16/16(緑)**。
  - 意図的バグ(複合型 `every`→`some`)で **FAIL 4/16** に転じ、テストが回帰を捕捉することも確認。
- 実機検証(preview browser、デスクトップ+モバイル375px):
  - 無線工学(single×2)を解いて 1/2・50%、誤答一覧に A-1 が表示。
  - 法規(single + truefalse_list + fill_blanks)を全問正解で 3/3・100%。
  - localStorage に2件が **append-only** で残る(1件目が無傷)ことを実機で確認。
  - 選択画面の成績表示(前回50%/最高50%/挑戦1回 等)が反映。

### SPECからの確定した変更(実物サンプルを正とした)
- スキーマ:`choices`→`options`、`image`→`figure`。問題型を `single` / `truefalse_list` / `fill_blanks` の3型に拡張(法規B問題が4択単一で表現不能なため)。
- **`answer` は 1始まり index**(SPEC原文の0始まりから変更)。既存サンプルを再編集しないための決定。
- ファイル単位は**期ごと1ファイル**(全科目同居)。SPEC原文の科目別ファイルから変更。
- 上記はユーザー(琥珀)承認済み:「3型すべて」「実物サンプル準拠」。

### 仮定(要確認・後で見直す)
- `data/index.json` の `count`(問題数)は手書き。Phase1で data から自動生成して二重管理をやめる。
- `wrong` は 0始まり index。人間可読ではないので、結果画面表示は index→問題詳細を引いて出している。SPEC例の数値形と整合。
- 図は `figures/R8-02-kougaku-A1.png` にプレースホルダ(320x180グレー枠)を置いた。実際の回路図切り出しはPhase1のデータ整形で差し替え。
- 日付は `new Date().toISOString().slice(0,10)`(UTC基準)。端末TZによっては1日ずれ得る。実用上は許容。

### 未解決 / 既知の制限
- preview browser の `computer`(座標クリック/スクショ)がタイムアウトしやすい。検証は実イベント発火(input.click / change dispatch)で代替した=本物のリスナーは通っている。
- GitHub Pages への公開は**未実施**(下記手順を用意)。リモートリポジトリはユーザーが作成する必要がある。
- データは R8-02 の1期・サンプル7問のみ。実問題の全量投入はPhase1。

### 次の初手(Phase1)
1. `koukuu-tuu/` の生PDF1回分(できれば無線工学)から、`data/{code}.json` への整形手順を1本確立する(手作業+検算)。図の切り出しも1枚やってみて実測時間を測る。
2. `data/index.json` を data から生成するスクリプト(Python)を書く。
3. 「1年分の3科目」を作った時点で一旦止め、実測時間を見て全期間へ広げるか判断(SPECの撤退・凍結条件)。

## GitHub Pages 公開手順(未実施・ユーザー操作が必要)

ローカルは `git init` 済み・初回コミット済み。以下はリモート作成と公開:

```
# 1. GitHubで空のリポジトリを作る(例: koukuu-quiz)。READMEは付けない。
# 2. このフォルダで:
git remote add origin https://github.com/<ユーザー名>/koukuu-quiz.git
git branch -M main
git push -u origin main
# 3. GitHub のリポジトリ → Settings → Pages →
#    Source: "Deploy from a branch" / Branch: main / フォルダ: /(root) → Save
# 4. 数分後 https://<ユーザー名>.github.io/koukuu-quiz/ で開ける(iPad/iPhoneで確認)。
```
注意:公開は外部への発信にあたるため、リモート追加・push はユーザーの明示操作で行う(このアプリはローカルcommitまで用意)。
