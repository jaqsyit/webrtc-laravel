<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class CallAnswerSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $toUserId,
        public int $fromUserId,
        public array $sdp,
    ) {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('call.'.$this->toUserId);
    }

    public function broadcastAs(): string
    {
        return 'call.answer';
    }

    public function broadcastWith(): array
    {
        return [
            'from' => $this->fromUserId,
            'sdp' => $this->sdp,
        ];
    }
}
