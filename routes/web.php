<?php

use App\Http\Controllers\ProfileController;
use App\Models\User;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/dashboard', function () {
    return view('dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

Route::post('/call/offer', function(Illuminate\Http\Request $r){
    broadcast(new \App\Events\CallOfferSent($r->to, auth()->id(), $r->sdp));
    return response()->noContent();
})->middleware('auth');

Route::post('/call/answer', function(Illuminate\Http\Request $r){
    broadcast(new \App\Events\CallAnswerSent($r->to, auth()->id(), $r->sdp));
    return response()->noContent();
})->middleware('auth');

Route::post('/call/candidate', function(Illuminate\Http\Request $r){
    broadcast(new \App\Events\IceCandidateSent($r->to, auth()->id(), $r->candidate));
    return response()->noContent();
})->middleware('auth');

Route::middleware('auth')->get('/video/{peer}', function (User $peer) {
    return view('call', ['peerId' => $peer->id, 'peer' => $peer]);
});

Route::middleware('auth')->get('/contacts', function () {
    $users = \App\Models\User::where('id', '!=', auth()->id())->get();
    return view('contacts', compact('users'));
});


require __DIR__.'/auth.php';
