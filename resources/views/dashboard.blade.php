<x-app-layout>
    <x-slot name="header">
        <div class="flex items-center justify-between gap-4">
            <h2 class="font-semibold text-xl text-gray-800 leading-tight">
                {{ __('Dashboard') }}
            </h2>

            <a
                href="{{ route('contacts.index') }}"
                class="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700"
            >
                Открыть контакты
            </a>
        </div>
    </x-slot>

    <div class="py-12">
        <div class="mx-auto grid max-w-7xl gap-6 sm:px-6 lg:px-8 xl:grid-cols-[1.3fr_.9fr]">
            <div class="overflow-hidden rounded-2xl bg-white shadow-sm">
                <div class="p-6 text-gray-900">
                    <p class="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">WebRTC Chat</p>
                    <h3 class="mt-2 text-2xl font-semibold text-slate-900">Вы в системе и готовы к звонкам</h3>
                    <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                        Перейдите в контакты, выберите собеседника и начните аудио- или видеозвонок в пару кликов.
                    </p>

                    <div class="mt-6 flex flex-wrap gap-3">
                        <a
                            href="{{ route('contacts.index') }}"
                            class="inline-flex items-center rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400"
                        >
                            Перейти к контактам
                        </a>
                        <span class="inline-flex items-center rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-600">
                            Доступно контактов: {{ $contactsCount }}
                        </span>
                    </div>
                </div>
            </div>

            <div class="overflow-hidden rounded-2xl bg-slate-900 shadow-sm">
                <div class="p-6 text-slate-50">
                    <p class="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">Быстрый старт</p>
                    <ul class="mt-4 space-y-3 text-sm leading-6 text-slate-200">
                        <li>1. Откройте страницу контактов.</li>
                        <li>2. Выберите пользователя слева, как в обычном чате.</li>
                        <li>3. Нажмите кнопку звонка и разрешите доступ к камере и микрофону.</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
</x-app-layout>
