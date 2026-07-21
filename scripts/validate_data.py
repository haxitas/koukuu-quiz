"""data/*.json の機械検査(出品前チェックの工学版)。

チェック項目:
  - questions が配列で、id が全体で一意
  - type は single / truefalse_list / fill_blanks のいずれか
  - single: answer は 1..len(options) の整数、blanks は null
  - 複合型: answer は null、blanks は非空、各 blank.answer は 1..len(options)
  - figure が null でなければ実ファイルが存在する
  - subject / text / options が空でない

使い方:  python scripts/validate_data.py
戻り値:  エラーがあれば終了コード1
"""
import json
import os
import sys
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
VALID_TYPES = {"single", "truefalse_list", "fill_blanks"}


def validate_file(path, seen_ids):
    errors = []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    qs = data.get("questions")
    if not isinstance(qs, list) or not qs:
        return [f"{os.path.basename(path)}: questions が配列でない/空"]
    for q in qs:
        qid = q.get("id", "<no-id>")
        tag = f"{os.path.basename(path)}:{qid}"
        if qid in seen_ids:
            errors.append(f"{tag}: id が重複")
        seen_ids.add(qid)
        if not q.get("subject"):
            errors.append(f"{tag}: subject が空")
        if not q.get("text"):
            errors.append(f"{tag}: text が空")
        t = q.get("type")
        if t not in VALID_TYPES:
            errors.append(f"{tag}: 未知の type={t!r}")
            continue
        opts = q.get("options")
        if not isinstance(opts, list) or len(opts) < 2:
            errors.append(f"{tag}: options が2件未満")
            continue
        n = len(opts)
        if t == "single":
            a = q.get("answer")
            if not isinstance(a, int) or not (1 <= a <= n):
                errors.append(f"{tag}: single の answer={a!r} が 1..{n} の範囲外")
            if q.get("blanks") is not None:
                errors.append(f"{tag}: single なのに blanks が非null")
        else:  # composite
            if q.get("answer") is not None:
                errors.append(f"{tag}: 複合型なのに answer が非null")
            blanks = q.get("blanks")
            if not isinstance(blanks, list) or not blanks:
                errors.append(f"{tag}: blanks が空")
                continue
            for b in blanks:
                ba = b.get("answer")
                if not isinstance(ba, int) or not (1 <= ba <= n):
                    errors.append(f"{tag}: blank {b.get('label')} の answer={ba!r} が 1..{n} 範囲外")
        fig = q.get("figure")
        if fig:
            if not os.path.exists(os.path.join(ROOT, fig)):
                errors.append(f"{tag}: figure が存在しない -> {fig}")
    return errors


def main():
    files = [p for p in glob.glob(os.path.join(DATA, "*.json"))
             if os.path.basename(p) != "index.json"]
    if not files:
        print("データファイルが無い"); return 1
    seen_ids = set()
    all_errors = []
    total_q = 0
    for path in sorted(files):
        with open(path, encoding="utf-8") as f:
            total_q += len(json.load(f).get("questions", []))
        all_errors += validate_file(path, seen_ids)
    if all_errors:
        print(f"NG: {len(all_errors)} 件のエラー")
        for e in all_errors:
            print("  -", e)
        return 1
    print(f"OK: {len(files)} ファイル / {total_q} 問 / id {len(seen_ids)}件すべて検査通過")
    return 0


if __name__ == "__main__":
    sys.exit(main())
