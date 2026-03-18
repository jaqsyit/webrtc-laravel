<x-app-layout>
    <x-slot name="header">
        <div class="flex items-center justify-between gap-4">
            <div>
                <h2 class="font-semibold text-xl text-gray-800 leading-tight">Контакты</h2>
                <p class="mt-1 text-sm text-slate-500">Выберите пользователя слева и начните звонок.</p>
            </div>

            <a
                href="{{ route('dashboard') }}"
                class="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
                Назад на дашборд
            </a>
        </div>
    </x-slot>

    <div class="py-8">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
                <div class="grid min-h-[70vh] lg:grid-cols-[340px_1fr]">
                    <aside class="border-b border-slate-200 bg-slate-950 text-white lg:border-b-0 lg:border-r">
                        <div class="border-b border-white/10 p-5">
                            <p class="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Список контактов</p>
                            <h3 class="mt-2 text-xl font-semibold">Ваши собеседники</h3>
                            <p class="mt-2 text-sm text-slate-400">Интерфейс теперь похож на мессенджер: список слева, активный чат справа.</p>
                        </div>

                        <div class="max-h-[calc(70vh-120px)] overflow-y-auto p-3">
                            @forelse($users as $user)
                                @php
                                    $isActive = $activePeer && $activePeer->id === $user->id;
                                    $initials = collect(explode(' ', trim($user->name)))
                                        ->filter()
                                        ->take(2)
                                        ->map(fn ($part) => mb_strtoupper(mb_substr($part, 0, 1)))
                                        ->implode('');
                                @endphp

                                <a
                                    href="{{ route('contacts.index', ['peer' => $user->id]) }}"
                                    class="mb-2 flex items-center gap-3 rounded-2xl px-4 py-3 transition {{ $isActive ? 'bg-emerald-500/20 ring-1 ring-emerald-400/40' : 'hover:bg-white/5' }}"
                                >
                                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-white">
                                        {{ $initials ?: 'U' }}
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-sm font-semibold text-white">{{ $user->name }}</div>
                                        <div class="truncate text-xs text-slate-400">{{ $user->email }}</div>
                                    </div>
                                    <span class="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                                        online
                                    </span>
                                </a>
                            @empty
                                <div class="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-400">
                                    Пока нет доступных контактов для звонка.
                                </div>
                            @endforelse
                        </div>
                    </aside>

                    <section class="flex flex-col bg-slate-50">
                        @if($activePeer)
                            @php
                                $activeInitials = collect(explode(' ', trim($activePeer->name)))
                                    ->filter()
                                    ->take(2)
                                    ->map(fn ($part) => mb_strtoupper(mb_substr($part, 0, 1)))
                                    ->implode('');
                            @endphp

                            <div class="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5">
                                <div class="flex items-center gap-4">
                                    <div class="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-lg font-semibold text-emerald-700">
                                        {{ $activeInitials ?: 'U' }}
                                    </div>
                                    <div>
                                        <h3 class="text-lg font-semibold text-slate-900">{{ $activePeer->name }}</h3>
                                        <p class="text-sm text-slate-500">{{ $activePeer->email }}</p>
                                    </div>
                                </div>

                                <a
                                    href="{{ route('call.show', $activePeer) }}"
                                    class="inline-flex items-center rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400"
                                >
                                    Позвонить
                                </a>
                            </div>

                            <div class="flex-1 space-y-6 p-6">
                                <div class="flex justify-start">
                                    <div class="max-w-xl rounded-3xl rounded-bl-md bg-white px-5 py-4 text-sm leading-6 text-slate-700 shadow-sm ring-1 ring-slate-200">
                                        Откройте страницу звонка и разрешите доступ к камере и микрофону. После этого можно сразу начинать видеозвонок.
                                    </div>
                                </div>

                                <div class="flex justify-end">
                                    <div class="max-w-xl rounded-3xl rounded-br-md bg-slate-900 px-5 py-4 text-sm leading-6 text-slate-100 shadow-sm">
                                        Интерфейс контактов теперь оформлен как чат: список собеседников слева и большое окно общения справа.
                                    </div>
                                </div>

                                <div class="grid gap-4 xl:grid-cols-2">
                                    <div class="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Что исправлено</p>
                                        <ul class="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                                            <li>• Подправлен real-time сигналинг для звонка.</li>
                                            <li>• Исправлен обмен answer и ICE candidate.</li>
                                            <li>• Улучшено подключение к Reverb по локальному ws/http.</li>
                                        </ul>
                                    </div>

                                    <div class="rounded-3xl bg-slate-900 p-5 text-slate-100 shadow-sm">
                                        <p class="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Как звонить</p>
                                        <ol class="mt-4 space-y-3 text-sm leading-6 text-slate-300">
                                            <li>1. Откройте карточку собеседника.</li>
                                            <li>2. Нажмите «Позвонить».</li>
                                            <li>3. На странице звонка нажмите «Инициализировать», затем «Позвонить» или «Ответить».</li>
                                        </ol>
                                    </div>
                                </div>
                            </div>
                        @else
                            <div class="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
                                <div class="max-w-md rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
                                    <h3 class="text-xl font-semibold text-slate-900">Контакты пока недоступны</h3>
                                    <p class="mt-3 text-sm leading-6 text-slate-500">
                                        В системе пока нет другого пользователя, которому можно позвонить.
                                    </p>
                                </div>
                            </div>
                        @endif
                    </section>
                </div>
            </div>
        </div>
    </div>
</x-app-layout>
