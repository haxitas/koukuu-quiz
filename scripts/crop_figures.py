"""PDF の指定ページの一部矩形(ページ比率指定)を PNG に切り出す。

回路図・波形図・アンテナ構造図などを問題ごとに切り出して figures/ に置く用途。
矩形はページに対する比率 (x0,y0,x1,y1) を 0〜1 で与える(左上原点)。

使い方(単発):
  python scripts/crop_figures.py <pdf> <page> <x0> <y0> <x1> <y1> <out.png> [dpi]
"""
import sys
import os
import fitz


def crop(pdf_path, page_no, frac, out_png, dpi=220):
    doc = fitz.open(pdf_path)
    page = doc[page_no]
    r = page.rect
    x0, y0, x1, y1 = frac
    clip = fitz.Rect(r.x0 + x0 * r.width, r.y0 + y0 * r.height,
                     r.x0 + x1 * r.width, r.y0 + y1 * r.height)
    zoom = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), clip=clip)
    os.makedirs(os.path.dirname(out_png), exist_ok=True)
    pix.save(out_png)
    return out_png


if __name__ == "__main__":
    a = sys.argv
    pdf, page = a[1], int(a[2])
    frac = tuple(float(x) for x in a[3:7])
    out = a[7]
    dpi = int(a[8]) if len(a) > 8 else 220
    crop(pdf, page, frac, out, dpi)
    print("wrote", out)
