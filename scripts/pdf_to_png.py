"""PDF の各ページを PNG に描画する(目視転記の土台)。

数式記号・回路図・解答表はテキスト抽出だと化ける/順序が乱れるため、
ページ画像を正として人(または Claude)が JSON へ転記する運用にする。

使い方:
  python scripts/pdf_to_png.py <input.pdf> <output_dir> [dpi]
出力:
  <output_dir>/p00.png, p01.png, ...
"""
import sys
import os
import fitz  # PyMuPDF


def render(pdf_path, out_dir, dpi=170):
    os.makedirs(out_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    written = []
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat)
        path = os.path.join(out_dir, f"p{i:02d}.png")
        pix.save(path)
        written.append(path)
    return written


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    pdf_path = sys.argv[1]
    out_dir = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 170
    paths = render(pdf_path, out_dir, dpi)
    print(f"rendered {len(paths)} page(s) at {dpi}dpi -> {out_dir}")
