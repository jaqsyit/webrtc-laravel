<ul>
    @foreach($users as $u)
        <li>
            {{ $u->name }} —
            <a href="{{ url('/video/'.$u->id) }}">Позвонить</a> {{-- тут и есть peerId --}}
        </li>
    @endforeach
</ul>
