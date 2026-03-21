<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Kreait\Firebase\Contract\Messaging;
use Kreait\Firebase\Factory;
use Kreait\Firebase\Messaging\CloudMessage;
use Kreait\Firebase\Messaging\Notification;

class SendTestFcmBannerCommand extends Command
{
    protected $signature = 'services:fcm-banner-test';
    protected $description = 'Command description';

    protected Messaging $messaging;

    public function handle(Factory $factory)
    {
        $project     = config('firebase.default', 'app');
        $credentials = config("firebase.projects.{$project}.credentials");

        $token = 'eUeUQNP9SlSYyJv2PY7QWo:APA91bFBuXkBtmMz0bPvpzdp3yZvCSRjFtlB_PRqf6qDS3U39nhjvHsuUfFuYuQwLOcmtann76hYEmHkqWmKuQvyAFW6vU_yssJ6i4yppwnM6FHeRQrCbb4';
        $this->messaging = $factory
            ->withServiceAccount($credentials)
            ->createMessaging();

        $message = CloudMessage::new()
            ->toToken($token)
            ->withNotification(Notification::create('Новый заказ','Заказ №A-123 ожидает подтверждения'))
            ->withData([
                'type' => 'new_order',
                'order_id' => '123',
                'order_number' => 'A-123',
                'route' => '/orders/123',
            ])
            ->withDefaultSounds();

        $response = $this->messaging->send($message);
        $this->info('Message sent: ' . json_encode($response));
    }
}
