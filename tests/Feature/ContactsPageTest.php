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
            ->assertSee((string) route('contacts.index'), false)
            ->assertSee('случайными двузначными числами');
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
            ->assertSee('Открыть чат / звонок')
            ->assertSee('двузначными числами')
            ->assertSee($peer->name)
            ->assertSee(route('call.show', $peer), false);
    }

    public function test_call_page_renders_session_ui_for_selected_peer(): void
    {
        $user = User::factory()->create();
        $peer = User::factory()->create([
            'name' => 'Мария Соколова',
        ]);

        $response = $this->actingAs($user)->get(route('call.show', $peer));

        $response
            ->assertOk()
            ->assertSee('Открыть сессию')
            ->assertSee('Отправляю')
            ->assertSee('Получаю')
            ->assertSee('двузначными числами')
            ->assertSee($peer->name);
    }
}
