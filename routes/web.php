<?php

use App\Http\Controllers\ProfileController;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/dashboard', function () {
    $contactsCount = User::query()->whereKeyNot(auth()->id())->count();

    return view('dashboard', compact('contactsCount'));
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

Route::post('/call/offer', function (Request $r) {
    $payload = $r->validate([
        'to' => ['required', 'integer', 'exists:users,id'],
        'sdp' => ['required', 'array'],
    ]);

    broadcast(new \App\Events\CallOfferSent($payload['to'], auth()->id(), $payload['sdp']));

    return response()->noContent();
})->middleware('auth')->name('call.offer');

Route::post('/call/answer', function (Request $r) {
    $payload = $r->validate([
        'to' => ['required', 'integer', 'exists:users,id'],
        'sdp' => ['required', 'array'],
    ]);

    broadcast(new \App\Events\CallAnswerSent($payload['to'], auth()->id(), $payload['sdp']));

    return response()->noContent();
})->middleware('auth')->name('call.answer');

Route::post('/call/candidate', function (Request $r) {
    $payload = $r->validate([
        'to' => ['required', 'integer', 'exists:users,id'],
        'candidate' => ['required', 'array'],
    ]);

    broadcast(new \App\Events\IceCandidateSent($payload['to'], auth()->id(), $payload['candidate']));

    return response()->noContent();
})->middleware('auth')->name('call.candidate');

Route::middleware('auth')->get('/video/{peer}', function (User $peer) {
    return view('call', ['peerId' => $peer->id, 'peer' => $peer]);
})->name('call.show');

Route::middleware('auth')->get('/contacts', function (Request $request) {
    $users = User::query()
        ->whereKeyNot(auth()->id())
        ->orderBy('name')
        ->get();

    $activePeer = $users->firstWhere('id', (int) $request->integer('peer')) ?? $users->first();

    return view('contacts', compact('users', 'activePeer'));
})->name('contacts.index');

require __DIR__.'/auth.php';
