<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class CallOfferSent implements ShouldBroadcastNow {
    use InteractsWithSockets, SerializesModels;
    public function __construct(public $toUserId, public $fromUserId, public $sdp){}
    public function broadcastOn(){ return new PrivateChannel('call.'.$this->toUserId); }
    public function broadcastAs(){ return 'call.offer'; }
    public function broadcastWith(){ return ['from'=>$this->fromUserId,'sdp'=>$this->sdp]; }
}
