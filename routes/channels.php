<?php

use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Log;

//Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
//    return (int) $user->id === (int) $id;
//});
Broadcast::channel('call.{userId}', function ($user, $userId) {
    Log::info('Broadcast channel accessed', ['user_id' => $user->id, 'channel_user_id' => $userId]);
    return (int)$user->id === (int)$userId;
});
