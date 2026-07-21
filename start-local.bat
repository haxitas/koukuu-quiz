@echo off
rem 航空無線通信士 過去問アプリ ローカル起動ランチャー
rem このファイルをダブルクリックすると、ローカルサーバーを立ち上げてブラウザで開きます。
rem 終了するときは、開いた黒いウィンドウで Ctrl+C を押すか、ウィンドウを閉じてください。
cd /d "%~dp0"
start "" http://localhost:8137/
python -m http.server 8137
