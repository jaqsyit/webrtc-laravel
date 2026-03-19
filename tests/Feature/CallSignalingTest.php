<?php

namespace Tests\Feature;

use App\Events\CallAnswerSent;
use App\Events\CallOfferSent;
use App\Events\IceCandidateSent;
use App\Models\User;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * Диагностика всей цепочки сигналинга WebRTC.
 *
 * Запуск:
 *   php artisan test --filter=CallSignalingTest -v
 */
class CallSignalingTest extends TestCase
{
    use RefreshDatabase;

    // ─── helpers ────────────────────────────────────────────────────

    private function fakeSdp(): array
    {
        return ['type' => 'offer', 'sdp' => 'v=0\r\nfake-sdp-payload'];
    }

    private function fakeCandidate(): array
    {
        return [
            'candidate'     => 'candidate:842163049 1 udp 1677729535 1.2.3.4 44444 typ srflx',
            'sdpMid'        => '0',
            'sdpMLineIndex' => 0,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    //  1. МАРШРУТ /broadcasting/auth — проверяем что он существует
    //     и работает с web+auth middleware
    // ═══════════════════════════════════════════════════════════════

    public function test_broadcasting_auth_route_exists(): void
    {
        $user = User::factory()->create();

        // Неавторизованный → редирект / 401 / 403
        $guest = $this->postJson('/broadcasting/auth', [
            'socket_id'    => '123456.654321',
            'channel_name' => 'private-call.' . $user->id,
        ]);

        // Для web middleware неавторизованный POST обычно возвращает 403 или redirect
        // Главное — НЕ 404 (маршрут не найден)
        $this->assertNotEquals(
            404,
            $guest->getStatusCode(),
            "FAIL: /broadcasting/auth маршрут НЕ НАЙДЕН (404)!\n"
            . "      → withBroadcasting() не зарегистрирован в bootstrap/app.php\n"
            . "      → или кэш маршрутов устарел (php artisan route:clear)"
        );

        echo "\n  ✅ [1/8] /broadcasting/auth маршрут существует (status: {$guest->getStatusCode()})\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  2. Авторизация канала — свой канал → true, чужой → false
    // ═══════════════════════════════════════════════════════════════

    public function test_channel_auth_allows_own_channel(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/broadcasting/auth', [
            'socket_id'    => '123456.654321',
            'channel_name' => 'private-call.' . $user->id,
        ]);

        $response->assertStatus(200);
        echo "\n  ✅ [2/8] Авторизация канала call.{$user->id} для owner → 200 OK\n";
    }

    public function test_channel_auth_denies_other_channel(): void
    {
        $alice = User::factory()->create();
        $bob   = User::factory()->create();

        $response = $this->actingAs($alice)->postJson('/broadcasting/auth', [
            'socket_id'    => '123456.654321',
            'channel_name' => 'private-call.' . $bob->id,
        ]);

        $response->assertStatus(403);
        echo "\n  ✅ [3/8] Авторизация чужого канала call.{$bob->id} для alice → 403 Forbidden\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  4. POST /call/offer — валидация + broadcast
    // ═══════════════════════════════════════════════════════════════

    public function test_call_offer_dispatches_event_to_correct_channel(): void
    {
        Event::fake([CallOfferSent::class]);

        $caller = User::factory()->create();
        $callee = User::factory()->create();
        $sdp    = $this->fakeSdp();

        $response = $this->actingAs($caller)->postJson('/call/offer', [
            'to'  => $callee->id,
            'sdp' => $sdp,
        ]);

        $response->assertNoContent();

        Event::assertDispatched(CallOfferSent::class, function (CallOfferSent $e) use ($caller, $callee, $sdp) {
            $channel = $e->broadcastOn();
            $channelName = $channel instanceof PrivateChannel ? $channel->name : (string) $channel;

            // Канал должен быть private-call.{callee_id}
            $correctChannel = str_contains($channelName, 'call.' . $callee->id);
            $correctFrom    = $e->fromUserId === $caller->id;
            $correctTo      = $e->toUserId === $callee->id;
            $correctSdp     = $e->sdp === $sdp;

            echo "\n  📋 [4/8] CallOfferSent диагностика:\n";
            echo "       channel:    {$channelName} " . ($correctChannel ? '✅' : '❌ ОЖИДАЛСЯ: private-call.' . $callee->id) . "\n";
            echo "       from:       {$e->fromUserId} " . ($correctFrom ? '✅' : "❌ ОЖИДАЛСЯ: {$caller->id}") . "\n";
            echo "       to:         {$e->toUserId} " . ($correctTo ? '✅' : "❌ ОЖИДАЛСЯ: {$callee->id}") . "\n";
            echo "       sdp.type:   " . ($e->sdp['type'] ?? 'NULL') . " " . ($correctSdp ? '✅' : '❌') . "\n";
            echo "       broadcastAs: " . $e->broadcastAs() . " " . ($e->broadcastAs() === 'call.offer' ? '✅' : '❌ ОЖИДАЛСЯ: call.offer') . "\n";

            return $correctChannel && $correctFrom && $correctTo && $correctSdp;
        });

        echo "  ✅ [4/8] POST /call/offer → CallOfferSent dispatched корректно\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  5. POST /call/answer — валидация + broadcast
    // ═══════════════════════════════════════════════════════════════

    public function test_call_answer_dispatches_event(): void
    {
        Event::fake([CallAnswerSent::class]);

        $caller = User::factory()->create();
        $callee = User::factory()->create();
        $sdp    = ['type' => 'answer', 'sdp' => 'v=0\r\nfake-answer-sdp'];

        $response = $this->actingAs($callee)->postJson('/call/answer', [
            'to'  => $caller->id,
            'sdp' => $sdp,
        ]);

        $response->assertNoContent();

        Event::assertDispatched(CallAnswerSent::class, function (CallAnswerSent $e) use ($caller, $callee) {
            $channel = $e->broadcastOn();
            $channelName = $channel instanceof PrivateChannel ? $channel->name : (string) $channel;

            $correctChannel = str_contains($channelName, 'call.' . $caller->id);

            echo "\n  📋 [5/8] CallAnswerSent диагностика:\n";
            echo "       channel:     {$channelName} " . ($correctChannel ? '✅' : '❌ ОЖИДАЛСЯ: private-call.' . $caller->id) . "\n";
            echo "       broadcastAs: " . $e->broadcastAs() . " " . ($e->broadcastAs() === 'call.answer' ? '✅' : '❌') . "\n";

            return $correctChannel;
        });

        echo "  ✅ [5/8] POST /call/answer → CallAnswerSent dispatched корректно\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  6. POST /call/candidate — валидация + broadcast
    // ═══════════════════════════════════════════════════════════════

    public function test_call_candidate_dispatches_event(): void
    {
        Event::fake([IceCandidateSent::class]);

        $caller = User::factory()->create();
        $callee = User::factory()->create();

        $response = $this->actingAs($caller)->postJson('/call/candidate', [
            'to'        => $callee->id,
            'candidate' => $this->fakeCandidate(),
        ]);

        $response->assertNoContent();

        Event::assertDispatched(IceCandidateSent::class, function (IceCandidateSent $e) use ($callee) {
            $channel = $e->broadcastOn();
            $channelName = $channel instanceof PrivateChannel ? $channel->name : (string) $channel;

            echo "\n  📋 [6/8] IceCandidateSent диагностика:\n";
            echo "       channel:     {$channelName}\n";
            echo "       broadcastAs: " . $e->broadcastAs() . "\n";

            return str_contains($channelName, 'call.' . $callee->id);
        });

        echo "  ✅ [6/8] POST /call/candidate → IceCandidateSent dispatched корректно\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  7. broadcastWith() — проверяем payload совпадает с тем что ждёт JS
    // ═══════════════════════════════════════════════════════════════

    public function test_offer_broadcast_payload_matches_js_expectations(): void
    {
        $sdp   = $this->fakeSdp();
        $event = new CallOfferSent(toUserId: 2, fromUserId: 1, sdp: $sdp);
        $data  = $event->broadcastWith();

        // JS ожидает: e.from (number) и e.sdp (object с type + sdp)
        $hasFrom    = array_key_exists('from', $data);
        $hasSdp     = array_key_exists('sdp', $data);
        $sdpHasType = isset($data['sdp']['type']);
        $sdpHasSdp  = isset($data['sdp']['sdp']);

        echo "\n  📋 [7/8] broadcastWith() payload для CallOfferSent:\n";
        echo "       " . json_encode($data, JSON_UNESCAPED_UNICODE) . "\n";
        echo "       has 'from':     " . ($hasFrom ? '✅' : '❌ JS ожидает e.from') . "\n";
        echo "       has 'sdp':      " . ($hasSdp ? '✅' : '❌ JS ожидает e.sdp') . "\n";
        echo "       sdp.type:       " . ($sdpHasType ? '✅' : '❌ JS ожидает e.sdp.type для normalizeSDP') . "\n";
        echo "       sdp.sdp:        " . ($sdpHasSdp ? '✅' : '❌ JS ожидает e.sdp.sdp для normalizeSDP') . "\n";

        $this->assertTrue($hasFrom, 'broadcastWith missing "from" key');
        $this->assertTrue($hasSdp, 'broadcastWith missing "sdp" key');
        $this->assertTrue($sdpHasType, 'broadcastWith sdp missing "type"');
        $this->assertTrue($sdpHasSdp, 'broadcastWith sdp missing "sdp" string');

        echo "  ✅ [7/8] broadcastWith() payload корректен для JS call.js\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  8. Полная симуляция — offer → ответ callee → answer
    //     Проверяем что оба пользователя могут пройти весь flow
    // ═══════════════════════════════════════════════════════════════

    public function test_full_signaling_flow(): void
    {
        Event::fake([CallOfferSent::class, CallAnswerSent::class, IceCandidateSent::class]);

        $caller = User::factory()->create(['name' => 'Caller']);
        $callee = User::factory()->create(['name' => 'Callee']);

        echo "\n  📋 [8/8] Полный flow сигналинга:\n";

        // Step 1: Caller → POST /call/offer
        $r1 = $this->actingAs($caller)->postJson('/call/offer', [
            'to'  => $callee->id,
            'sdp' => $this->fakeSdp(),
        ]);
        echo "       [1] Caller POST /call/offer  → {$r1->getStatusCode()} " . ($r1->getStatusCode() === 204 ? '✅' : '❌') . "\n";
        $this->assertEquals(204, $r1->getStatusCode());

        // Step 2: Callee авторизует канал
        $r2 = $this->actingAs($callee)->postJson('/broadcasting/auth', [
            'socket_id'    => '111.222',
            'channel_name' => 'private-call.' . $callee->id,
        ]);
        echo "       [2] Callee auth call.{$callee->id} → {$r2->getStatusCode()} " . ($r2->getStatusCode() === 200 ? '✅' : '❌') . "\n";
        $this->assertEquals(200, $r2->getStatusCode());

        // Step 3: Callee → POST /call/answer
        $r3 = $this->actingAs($callee)->postJson('/call/answer', [
            'to'  => $caller->id,
            'sdp' => ['type' => 'answer', 'sdp' => 'v=0\r\nfake-answer'],
        ]);
        echo "       [3] Callee POST /call/answer → {$r3->getStatusCode()} " . ($r3->getStatusCode() === 204 ? '✅' : '❌') . "\n";
        $this->assertEquals(204, $r3->getStatusCode());

        // Step 4: Caller авторизует свой канал
        $r4 = $this->actingAs($caller)->postJson('/broadcasting/auth', [
            'socket_id'    => '333.444',
            'channel_name' => 'private-call.' . $caller->id,
        ]);
        echo "       [4] Caller auth call.{$caller->id} → {$r4->getStatusCode()} " . ($r4->getStatusCode() === 200 ? '✅' : '❌') . "\n";
        $this->assertEquals(200, $r4->getStatusCode());

        // Step 5: ICE candidate
        $r5 = $this->actingAs($caller)->postJson('/call/candidate', [
            'to'        => $callee->id,
            'candidate' => $this->fakeCandidate(),
        ]);
        echo "       [5] Caller POST /call/candidate → {$r5->getStatusCode()} " . ($r5->getStatusCode() === 204 ? '✅' : '❌') . "\n";
        $this->assertEquals(204, $r5->getStatusCode());

        // Проверяем все события
        Event::assertDispatched(CallOfferSent::class);
        Event::assertDispatched(CallAnswerSent::class);
        Event::assertDispatched(IceCandidateSent::class);

        echo "  ✅ [8/8] Полный flow сигналинга прошёл успешно\n";
    }

    // ═══════════════════════════════════════════════════════════════
    //  GUARD: неавторизованный юзер не может вызвать /call/* роуты
    // ═══════════════════════════════════════════════════════════════

    public function test_unauthenticated_cannot_call(): void
    {
        $user = User::factory()->create();

        $r1 = $this->postJson('/call/offer', ['to' => $user->id, 'sdp' => $this->fakeSdp()]);
        $r2 = $this->postJson('/call/answer', ['to' => $user->id, 'sdp' => $this->fakeSdp()]);
        $r3 = $this->postJson('/call/candidate', ['to' => $user->id, 'candidate' => $this->fakeCandidate()]);

        // Для web middleware без auth → redirect или 401
        $this->assertContains($r1->getStatusCode(), [401, 302, 419]);
        $this->assertContains($r2->getStatusCode(), [401, 302, 419]);
        $this->assertContains($r3->getStatusCode(), [401, 302, 419]);

        echo "\n  ✅ [GUARD] Неавторизованный не может вызвать /call/* маршруты ({$r1->getStatusCode()}, {$r2->getStatusCode()}, {$r3->getStatusCode()})\n";
    }
}

