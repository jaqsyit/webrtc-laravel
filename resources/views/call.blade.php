<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="user-id" content="{{ auth()->id() }}">
    <meta name="peer-id" content="{{ $peerId }}">
    <meta name="app-env" content="{{ app()->environment() }}">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Сессия связи с {{ $peer->name }}</title>
    @vite('resources/js/app.js')
    <style>
        :root{color-scheme:dark}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;background:linear-gradient(180deg,#08111d 0%,#111827 100%);color:#e5eefb}
        .page{max-width:1280px;margin:0 auto;padding:24px}
        .header,.controls,.stats,.media-grid,.bottom-grid{display:grid;gap:16px}
        .header{grid-template-columns:repeat(auto-fit,minmax(280px,1fr));align-items:start}
        .card{background:rgba(15,23,42,.88);border:1px solid rgba(148,163,184,.18);border-radius:24px;box-shadow:0 20px 60px rgba(15,23,42,.35)}
        .header-card{padding:24px}
        .title{margin:0;font-size:30px;line-height:1.15}
        .muted{color:#94a3b8}
        .badges{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
        .badge{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;background:#172554;color:#bfdbfe;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        .badge.success{background:#052e16;color:#86efac}
        .badge.warn{background:#3f2208;color:#fdba74}
        .header-actions{display:flex;justify-content:flex-end;align-items:flex-start}
        .link-btn,button{border:0;border-radius:16px;padding:12px 16px;font-size:14px;font-weight:700;cursor:pointer;text-decoration:none;transition:.2s ease}
        .link-btn{background:#e2e8f0;color:#0f172a}
        button{background:#1e293b;color:#e2e8f0}
        button.primary{background:#10b981;color:white}
        button.danger{background:#dc2626;color:white}
        button[disabled]{opacity:.45;cursor:not-allowed}
        .controls{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:18px}
        .stats{grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:18px}
        .stat-card{padding:18px 20px}
        .stat-label{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#94a3b8}
        .stat-value{margin-top:10px;font-size:42px;font-weight:800;line-height:1}
        .stat-meta{margin-top:8px;font-size:13px;color:#cbd5e1}
        .media-grid,.bottom-grid{grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:18px}
        .media-card{padding:18px}
        .media-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .media-frame{display:flex;align-items:center;justify-content:center;min-height:260px;border-radius:22px;background:#020617;border:1px solid rgba(148,163,184,.18);overflow:hidden}
        video{width:100%;height:100%;aspect-ratio:16/9;background:#020617;object-fit:cover}
        audio{display:none}
        .placeholder{padding:28px;text-align:center;color:#94a3b8;line-height:1.7}
        .list-card{padding:18px 20px}
        .list{list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:10px;max-height:280px;overflow:auto}
        .list li{border-radius:16px;padding:12px 14px;background:rgba(30,41,59,.72);border:1px solid rgba(148,163,184,.12);color:#dbeafe;font-size:14px;line-height:1.5}
        .status{margin-top:18px;padding:14px 18px;border-radius:18px;background:rgba(15,23,42,.92);border:1px solid rgba(59,130,246,.2);font-size:14px;color:#dbeafe}
        .tips{margin:14px 0 0;padding-left:18px;color:#cbd5e1;line-height:1.7}
        @media (max-width: 640px){.page{padding:16px}.title{font-size:24px}.stat-value{font-size:34px}}
    </style>
</head>
<body>
<div class="page">
    <div class="header">
        <div class="card header-card">
            <p class="muted" style="margin:0 0 10px;font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;">Сессия связи</p>
            <h1 class="title">{{ $peer->name }}</h1>
            <p class="muted" style="margin:10px 0 0;max-width:760px;line-height:1.7;">
                В `local` режиме камера и микрофон не используются: вместо этого после соединения обе стороны обмениваются случайными двузначными числами каждые 2 секунды.
                В `production` по HTTPS включаются реальные аудио и видео.
            </p>
            <div class="badges">
                <span id="modeBadge" class="badge">Определяем режим…</span>
                <span class="badge success">Внешний websocket: `:9090`</span>
                <span class="badge warn">Внутренний Reverb: `8081`</span>
            </div>
        </div>

        <div class="header-actions">
            <a class="link-btn" href="{{ route('contacts.index', ['peer' => $peer->id]) }}">← Назад к контактам</a>
        </div>
    </div>

    <div class="controls">
        <button id="btnInit" class="primary">Открыть сессию</button>
        <button id="btnCall" disabled>Позвонить</button>
        <button id="btnAnswer" disabled>Ответить</button>
        <button id="btnHangup" class="danger" disabled>Завершить</button>
        <button id="btnMic" disabled>Микрофон выкл</button>
        <button id="btnCam" disabled>Камера выкл</button>
        <button id="btnShare" disabled>Шэр экрана</button>
    </div>

    <div class="stats">
        <div class="card stat-card">
            <div class="stat-label">Отправляю</div>
            <div id="sentValue" class="stat-value">--</div>
            <div id="sentMeta" class="stat-meta">Нет данных</div>
        </div>
        <div class="card stat-card">
            <div class="stat-label">Получаю</div>
            <div id="receivedValue" class="stat-value">--</div>
            <div id="receivedMeta" class="stat-meta">Нет данных</div>
        </div>
        <div class="card stat-card">
            <div class="stat-label">Режим</div>
            <div id="modeValue" class="stat-value" style="font-size:28px;line-height:1.25;">Подготовка…</div>
            <div id="modeHint" class="stat-meta">Проверяем окружение и доступность media.</div>
        </div>
    </div>

    <div class="media-grid">
        <section class="card media-card">
            <div class="media-title">
                <strong>Вы</strong>
                <span class="muted">локальный поток</span>
            </div>
            <div class="media-frame">
                <video id="local" autoplay playsinline muted></video>
                <div id="localPlaceholder" class="placeholder">
                    В local-режиме здесь остаётся заглушка, потому что вместо камеры/микрофона работает data-channel с двузначными числами.
                </div>
            </div>
            <audio id="localAudio" autoplay muted></audio>
        </section>

        <section class="card media-card">
            <div class="media-title">
                <strong>Собеседник</strong>
                <span class="muted">удалённый поток</span>
            </div>
            <div class="media-frame">
                <video id="remote" autoplay playsinline></video>
                <div id="remotePlaceholder" class="placeholder">
                    После установления соединения здесь появится видео собеседника или начнут обновляться полученные двузначные числа.
                </div>
            </div>
            <audio id="remoteAudio" autoplay></audio>
        </section>
    </div>

    <div class="bottom-grid">
        <section class="card list-card">
            <strong>Лог активности</strong>
            <ul id="activityLog" class="list">
                <li>Ожидаем инициализацию страницы…</li>
            </ul>
        </section>

        <section class="card list-card">
            <strong>Как проверить</strong>
            <ul class="tips">
                <li>Откройте двух пользователей в разных браузерах или устройствах.</li>
                <li>В `local` режиме нажмите <b>Открыть сессию</b>, затем один пользователь нажимает <b>Позвонить</b>, второй — <b>Ответить</b>.</li>
                <li>После `connected` каждые 2 секунды должны обновляться блоки <b>Отправляю</b> и <b>Получаю</b>.</li>
                <li>В `production` по HTTPS вместо чисел должны появиться реальные аудио и видео.</li>
            </ul>
        </section>
    </div>

    <div id="status" class="status">Статус: готовим интерфейс…</div>
</div>
</body>
</html>

