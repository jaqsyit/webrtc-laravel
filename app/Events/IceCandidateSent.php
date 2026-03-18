<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class IceCandidateSent implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public int $toUserId,
        public int $fromUserId,
        public array $candidate,
    ) {
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('call.'.$this->toUserId);
    }

    public function broadcastAs(): string
    {
        return 'call.candidate';
    }

    public function broadcastWith(): array
    {
        return [
            'from' => $this->fromUserId,
            'candidate' => $this->candidate,
        ];
    }
}
