<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ContactsPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_open_dashboard_with_contacts_button(): void
    {
        $user = User::factory()->create();
        User::factory()->count(2)->create();

        $response = $this->actingAs($user)->get(route('dashboard'));

        $response
            ->assertOk()
            ->assertSee('Открыть контакты')
            ->assertSee((string) route('contacts.index'), false);
    }

    public function test_contacts_page_renders_chat_like_layout_and_call_link(): void
    {
        $user = User::factory()->create();
        $peer = User::factory()->create([
            'name' => 'Иван Петров',
            'email' => 'ivan@example.com',
        ]);

        $response = $this->actingAs($user)->get(route('contacts.index', ['peer' => $peer->id]));

        $response
            ->assertOk()
            ->assertSee('Список контактов')
            ->assertSee('Позвонить')
            ->assertSee($peer->name)
            ->assertSee(route('call.show', $peer), false);
    }
}

