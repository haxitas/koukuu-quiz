"""data/*.json から data/index.json を自動生成する(手書きの二重管理をやめる)。

各データファイルの meta.code / meta.era と、科目ごとの問題数を集計して一覧化する。
使い方:  python scripts/build_index.py
"""
import json
import os
import glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

# 科目の並び順(選択画面での表示順)
SUBJECT_ORDER = ["無線工学", "法規", "英語", "英会話"]


def subject_key(name):
    return (SUBJECT_ORDER.index(name) if name in SUBJECT_ORDER else 99, name)


def build():
    exams = []
    files = [p for p in glob.glob(os.path.join(DATA, "*.json"))
             if os.path.basename(p) != "index.json"]
    for path in sorted(files):
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        meta = data.get("meta", {})
        counts = {}
        for q in data.get("questions", []):
            s = q.get("subject", "不明")
            counts[s] = counts.get(s, 0) + 1
        subjects = [{"subject": s, "count": counts[s]}
                    for s in sorted(counts, key=subject_key)]
        exams.append({
            "code": meta.get("code", os.path.splitext(os.path.basename(path))[0]),
            "era": meta.get("era", ""),
            "file": os.path.basename(path),
            "subjects": subjects,
        })
    # code の新しい順(降順)で並べる
    exams.sort(key=lambda e: e["code"], reverse=True)
    return {"note": "scripts/build_index.py で data/*.json から自動生成。手で編集しない。", "exams": exams}


if __name__ == "__main__":
    idx = build()
    out = os.path.join(DATA, "index.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)
        f.write("\n")
    total = sum(s["count"] for e in idx["exams"] for s in e["subjects"])
    print(f"wrote {out}: {len(idx['exams'])} exam(s), {total} 問")
