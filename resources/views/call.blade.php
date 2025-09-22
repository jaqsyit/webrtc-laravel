<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="user-id" content="{{ auth()->id() }}">
    <meta name="peer-id" content="{{ $peerId }}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Видео-звонок с {{ $peer->name }}</title>
    @vite('resources/js/app.js')
    <style>
        body{font-family: system-ui,Arial; margin:0; padding:16px; background:#0b0f14; color:#e7edf3}
        .grid{display:grid; gap:12px; grid-template-columns:1fr 1fr}
        video{width:100%; aspect-ratio:16/9; background:#111; border-radius:12px}
        .controls{display:flex; gap:8px; flex-wrap:wrap}
        button,select{padding:10px 14px; border-radius:10px; border:0; background:#1c2430; color:#e7edf3; cursor:pointer}
        button[disabled]{opacity:.5; cursor:not-allowed}
        .pill{padding:6px 10px; background:#15202b; border-radius:999px; font-size:12px; opacity:.9}
    </style>
</head>
<body>
<h3>Звонок: вы → {{ $peer->name }}</h3>
<div class="pill">Подсказка: на localhost (или 127.0.0.1) getUserMedia работает без HTTPS.</div>

<div class="grid" style="margin-top:12px">
    <div>
        <div style="margin-bottom:6px">Вы</div>
        <video id="local" autoplay playsinline muted></video>
    </div>
    <div>
        <div style="margin-bottom:6px">Собеседник</div>
        <video id="remote" autoplay playsinline></video>
    </div>
</div>

<div class="controls" style="margin-top:12px">
    <button id="btnInit">Инициализировать</button>
    <button id="btnCall" disabled>Позвонить</button>
    <button id="btnAnswer" disabled>Ответить</button>
    <button id="btnHangup" disabled>Завершить</button>
    <button id="btnMic" disabled>Микрофон вкл/выкл</button>
    <button id="btnCam" disabled>Камера вкл/выкл</button>
    <button id="btnShare" disabled>Шэр экрана</button>
</div>

<div id="status" class="pill" style="margin-top:8px">Статус: готов</div>
</body>
</html>

